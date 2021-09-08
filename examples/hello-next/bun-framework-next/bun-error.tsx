import type {
  FallbackMessageContainer,
  JSException as JSExceptionType,
  Message,
  SourceLine,
  StackFrame,
  Problems,
  FallbackStep,
  StackTrace,
  Location,
  JSException,
  WebsocketMessageBuildFailure,
} from "../../../src/api/schema";

import ReactDOM from "react-dom";
import {
  useCallback,
  useState,
  useEffect,
  useLayoutEffect,
  createContext,
  useContext,
  Children,
} from "react";

enum StackFrameScope {
  Eval = 1,
  Module = 2,
  Function = 3,
  Global = 4,
  Wasm = 5,
  Constructor = 6,
}

enum JSErrorCode {
  Error = 0,
  EvalError = 1,
  RangeError = 2,
  ReferenceError = 3,
  SyntaxError = 4,
  TypeError = 5,
  URIError = 6,
  AggregateError = 7,

  // StackOverflow & OutOfMemoryError is not an ErrorType in <JavaScriptCore/ErrorType.h> within JSC, so the number here is just totally made up
  OutOfMemoryError = 8,
  BundlerError = 252,
  StackOverflow = 253,
  UserErrorCode = 254,
}

const JSErrorCodeLabel = {
  0: "Error",
  1: "EvalError",
  2: "RangeError",
  3: "ReferenceError",
  4: "SyntaxError",
  5: "TypeError",
  6: "URIError",
  7: "AggregateError",
  253: "StackOverflow",
  8: "OutOfMemory",
};

const BUN_ERROR_CONTAINER_ID = "__bun-error__";

enum RuntimeType {
  Nothing = 0x0,
  Function = 0x1,
  Undefined = 0x2,
  Null = 0x4,
  Boolean = 0x8,
  AnyInt = 0x10,
  Number = 0x20,
  String = 0x40,
  Object = 0x80,
  Symbol = 0x100,
  BigInt = 0x200,
}

enum ErrorTagType {
  build,
  resolve,
  server,
  client,
  hmr,
}

const ErrorTag = ({ type }: { type: ErrorTagType }) => (
  <div className={`BunError-ErrorTag BunError-ErrorTag--${ErrorTagType[type]}`}>
    {ErrorTagType[type]}
  </div>
);

const errorTags = [
  <ErrorTag type={ErrorTagType.build}></ErrorTag>,
  <ErrorTag type={ErrorTagType.resolve}></ErrorTag>,
  <ErrorTag type={ErrorTagType.server}></ErrorTag>,
  <ErrorTag type={ErrorTagType.client}></ErrorTag>,
  <ErrorTag type={ErrorTagType.hmr}></ErrorTag>,
];

const normalizedFilename = (filename: string, cwd: string): string => {
  if (filename.startsWith(cwd)) {
    return filename.substring(cwd.length);
  }

  return filename;
};

const blobFileURL = (filename: string): string => {
  return new URL("/blob:" + filename, location.href).href;
};

const srcFileURL = (filename: string, line: number, column: number): string => {
  if (filename.endsWith(".bun")) {
    return new URL("/" + filename, location.href).href;
  }

  var base = `/src:${filename}`;
  if (line > -1) {
    base = base + `:${line}`;

    if (column > -1) {
      base = base + `:${column}`;
    }
  }

  return new URL(base, location.href).href;
};

class FancyTypeError {
  constructor(exception: JSException) {
    this.runtimeType = exception.runtime_type || 0;
    this.runtimeTypeName = RuntimeType[this.runtimeType] || "undefined";
    this.message = exception.message;
    this.explain = "";

    this.normalize(exception);
  }

  runtimeType: RuntimeType;
  explain: string;
  runtimeTypeName: string;
  message: string;

  normalize(exception: JSException) {
    let i = exception.message.lastIndexOf(" is ");
    if (i === -1) return;
    const partial = exception.message.substring(i + " is ".length);
    const nextWord = /(["a-zA-Z0-9_\.]+)\)$/.exec(partial);
    if (nextWord && nextWord[0]) {
      this.runtimeTypeName = nextWord[0];
      this.runtimeTypeName = this.runtimeTypeName.substring(
        0,
        this.runtimeTypeName.length - 1
      );
      switch (this.runtimeTypeName.toLowerCase()) {
        case "undefined": {
          this.runtimeType = RuntimeType.Undefined;
          break;
        }
        case "null": {
          this.runtimeType = RuntimeType.Null;
          break;
        }
        case "string": {
          this.runtimeType = RuntimeType.String;
          break;
        }
        case "true":
        case "false": {
          this.runtimeType = RuntimeType.Boolean;
          break;
        }

        case "number":
          this.runtimeType = RuntimeType.Number;
          break;

        case "bigint":
          this.runtimeType = RuntimeType.BigInt;
          break;

        case "symbol":
          this.runtimeType = RuntimeType.Symbol;
          break;
        default: {
          this.runtimeType = RuntimeType.Object;
          break;
        }
      }
      this.message = exception.message.substring(0, i);
      this.message = this.message.substring(
        0,
        this.message.lastIndexOf("(In ")
      );
    }
  }
}

var onClose = dismissError;

const IndentationContext = createContext(0);
const SourceLines = ({
  sourceLines,
  highlight = -1,
  highlightColumnStart = 0,
  highlightColumnEnd = Infinity,
  children,
}: {
  sourceLines: SourceLine[];
  highlightColumnStart: number;
  highlightColumnEnd: number;
  highlight: number;
}) => {
  let start = sourceLines.length;
  let end = 0;
  let dedent = Infinity;
  let originalLines = new Array(sourceLines.length);
  let _i = 0;
  for (let i = 0; i < sourceLines.length; i++) {
    // bun only prints \n, no \r\n, so this should work fine
    sourceLines[i].text = sourceLines[i].text.replaceAll("\n", "");

    // This will now only trim spaces (and vertical tab character which never prints)
    const left = sourceLines[i].text.trimLeft();

    if (left.length > 0) {
      start = Math.min(start, i);
      end = Math.max(end, i + 1);

      dedent = Math.min(sourceLines[i].text.length - left.length, dedent);
    }
  }

  const _sourceLines = sourceLines.slice(start, end);
  const childrenArray = children || [];
  const numbers = new Array(_sourceLines.length + childrenArray.length);
  const lines = new Array(_sourceLines.length + childrenArray.length);

  let highlightI = 0;
  for (let i = 0; i < _sourceLines.length; i++) {
    const { line, text } = _sourceLines[i];
    const classes = {
      empty: text.trim().length === 0,
      highlight: highlight + 1 === line || _sourceLines.length === 1,
    };
    if (classes.highlight) highlightI = i;
    const _text = classes.empty ? "" : text.substring(dedent);
    lines[i] = (
      <div
        key={i}
        className={`BunError-SourceLine-text ${
          classes.empty ? "BunError-SourceLine-text--empty" : ""
        } ${classes.highlight ? "BunError-SourceLine-text--highlight" : ""}`}
      >
        {classes.highlight ? (
          <>
            {_text.substring(0, highlightColumnStart - dedent)}
            <span id="BunError-SourceLine-text-highlightExpression">
              {_text.substring(
                highlightColumnStart - dedent,
                highlightColumnEnd - dedent
              )}
            </span>
            {_text.substring(highlightColumnEnd - dedent)}
          </>
        ) : (
          _text
        )}
      </div>
    );
    numbers[i] = (
      <div
        key={line}
        className={`BunError-SourceLine-number ${
          classes.empty ? "BunError-SourceLine-number--empty" : ""
        } ${classes.highlight ? "BunError-SourceLine-number--highlight" : ""}`}
      >
        {line}
      </div>
    );

    if (classes.highlight && children) {
      i++;

      numbers.push(
        ...childrenArray.map((child, index) => (
          <div
            key={"highlight-number-" + index}
            className={`BunError-SourceLine-number ${
              classes.empty ? "BunError-SourceLine-number--empty" : ""
            } ${
              classes.highlight ? "BunError-SourceLine-number--highlight" : ""
            }`}
          ></div>
        ))
      );
      lines.push(
        ...childrenArray.map((child, index) => (
          <div
            key={"highlight-line-" + index}
            className={`BunError-SourceLine-text`}
          >
            {childrenArray[index]}
          </div>
        ))
      );
    }
  }

  return (
    <IndentationContext.Provider value={dedent}>
      <div className="BunError-SourceLines">
        <div
          className={`BunError-SourceLines-highlighter--${highlightI}`}
        ></div>

        <div className="BunError-SourceLines-numbers">{numbers}</div>
        <div className="BunError-SourceLines-lines">{lines}</div>
      </div>
    </IndentationContext.Provider>
  );
};

const BuildErrorSourceLines = ({ location }: { location: Location }) => {
  const { line, line_text, column, file } = location;
  const sourceLines: SourceLine[] = [{ line, text: line_text }];
  return (
    <SourceLines
      sourceLines={sourceLines}
      highlight={line}
      highlightColumnStart={column}
      highlightColumnEnd={column}
    />
  );
};

const BuildErrorStackTrace = ({ location }: { location: Location }) => {
  const { cwd } = useContext(ErrorGroupContext);
  const filename = normalizedFilename(location.file, cwd);
  const { line, column } = location;
  return (
    <div className={`BunError-NativeStackTrace`}>
      <a
        href={srcFileURL(filename, line, column)}
        target="_blank"
        className="BunError-NativeStackTrace-filename"
      >
        {filename}:{line}:{column}
      </a>
      <BuildErrorSourceLines location={location} />
    </div>
  );
};

const StackFrameIdentifier = ({
  functionName,
  scope,
}: {
  functionName?: string;
  scope: StackFrameScope;
}) => {
  switch (scope) {
    case StackFrameScope.Constructor: {
      return functionName ? `new ${functionName}` : "new (anonymous)";
      break;
    }

    case StackFrameScope.Eval: {
      return "eval";
      break;
    }

    case StackFrameScope.Module: {
      return "(esm)";
      break;
    }

    case StackFrameScope.Global: {
      return "(global)";
      break;
    }

    case StackFrameScope.Wasm: {
      return "(wasm)";
      break;
    }

    default: {
      return functionName ? functionName : "λ()";
      break;
    }
  }
};

const NativeStackFrame = ({
  frame,
  isTop,
}: {
  frame: StackFrame;
  isTop: boolean;
}) => {
  const { cwd } = useContext(ErrorGroupContext);
  const {
    file,
    function_name: functionName,
    position: { line, column_start: column },
    scope,
  } = frame;
  const fileName = normalizedFilename(file, cwd);
  return (
    <div
      className={`BunError-StackFrame ${
        fileName.endsWith(".bun") ? "BunError-StackFrame--muted" : ""
      }`}
    >
      <div
        title={StackFrameScope[scope]}
        className="BunError-StackFrame-identifier"
      >
        <StackFrameIdentifier functionName={functionName} scope={scope} />
      </div>

      <a
        target="_blank"
        href={blobFileURL(fileName)}
        className="BunError-StackFrame-link"
      >
        <div className="BunError-StackFrame-link-content">
          <div className={`BunError-StackFrame-file`}>{fileName}</div>
          {line > -1 && (
            <div className="BunError-StackFrame-line">:{line + 1}</div>
          )}
          {column > -1 && (
            <div className="BunError-StackFrame-column">:{column}</div>
          )}
        </div>
      </a>
    </div>
  );
};

const NativeStackFrames = ({ frames }) => {
  const items = new Array(frames.length);
  for (let i = 0; i < frames.length; i++) {
    items[i] = <NativeStackFrame key={i} frame={frames[i]} />;
  }

  return <div className="BunError-StackFrames">{items}</div>;
};

const NativeStackTrace = ({
  frames,
  sourceLines,
  children,
}: {
  frames: StackFrame[];
  sourceLines: SourceLine[];
}) => {
  const { file = "", position } = frames[0];
  const { cwd } = useContext(ErrorGroupContext);
  const filename = normalizedFilename(file, cwd);
  return (
    <div className={`BunError-NativeStackTrace`}>
      <a
        href={blobFileURL(filename)}
        target="_blank"
        className="BunError-NativeStackTrace-filename"
      >
        {filename}:{position.line + 1}:{position.column_start}
      </a>
      {sourceLines.length > 0 && (
        <SourceLines
          highlight={position.line}
          sourceLines={sourceLines}
          highlightColumnStart={position.column_start}
          highlightColumnEnd={position.column_stop}
        >
          {children}
        </SourceLines>
      )}
      {frames.length > 0 && <NativeStackFrames frames={frames} />}
    </div>
  );
};

const divet = <span className="BunError-divet">^</span>;
const DivetRange = ({ start, stop }) => {
  const length = Math.max(stop - start, 0);
  if (length === 0) return null;
  return (
    <span
      className="BunError-DivetRange"
      style={{ width: `${length - 1}ch` }}
    ></span>
  );
};

const Indent = ({ by, children }) => {
  const amount = useContext(IndentationContext);
  return (
    <>
      {` `.repeat(by - amount)}
      {children}
    </>
  );
};

const JSException = ({ value }: { value: JSExceptionType }) => {
  switch (value.code) {
    case JSErrorCode.TypeError: {
      const fancyTypeError = new FancyTypeError(value);

      if (fancyTypeError.runtimeType !== RuntimeType.Nothing) {
        return (
          <div
            className={`BunError-JSException BunError-JSException--TypeError`}
          >
            <div className="BunError-error-header">
              <div className={`BunError-error-code`}>TypeError</div>
              {errorTags[ErrorTagType.server]}
            </div>

            <div className={`BunError-error-message`}>
              {fancyTypeError.message}
            </div>

            {fancyTypeError.runtimeTypeName.length && (
              <div className={`BunError-error-subtitle`}>
                It's{" "}
                <span className="BunError-error-typename">
                  {fancyTypeError.runtimeTypeName}
                </span>
                .
              </div>
            )}

            {value.stack && (
              <NativeStackTrace
                frames={value.stack.frames}
                sourceLines={value.stack.source_lines}
              >
                <Indent by={value.stack.frames[0].position.column_start}>
                  <span className="BunError-error-typename">
                    {fancyTypeError.runtimeTypeName}
                  </span>
                </Indent>
              </NativeStackTrace>
            )}
          </div>
        );
      }
    }

    default: {
      return (
        <div className={`BunError-JSException`}>
          <div className="BunError-error-header">
            <div className={`BunError-error-code`}>{value.name}</div>
            {errorTags[ErrorTagType.server]}
          </div>

          <div className={`BunError-error-message`}>{value.message}</div>

          {value.stack && (
            <NativeStackTrace
              frames={value.stack.frames}
              sourceLines={value.stack.source_lines}
            />
          )}
        </div>
      );
    }
  }
};

const Summary = ({
  errorCount,
  onClose,
}: {
  errorCount: number;
  onClose: Function;
}) => {
  return (
    <div className="BunError-Summary">
      <div className="BunError-Summary-ErrorIcon"></div>
      <div className="BunError-Summary-Title">
        {errorCount}&nbsp;error{errorCount > 1 ? "s" : ""}&nbsp;on this page
      </div>

      <div onClick={onClose} className="BunError-Summary-CloseButton">
        <div className="BunError-Summary-CloseIcon"></div>
      </div>
    </div>
  );
};

const BuildError = ({ message }: { message: Message }) => {
  let title = (message.data.text || "").trim();
  const newline = title.indexOf("\n");
  let subtitle = "";
  if (newline > -1) {
    subtitle = title.slice(newline + 1).trim();
    title = title.slice(0, newline);
  }
  return (
    <div className={`BunError-BuildError BunError-BuildError--build`}>
      <div className="BunError-error-header">
        <div className={`BunError-error-code`}>BuildError</div>
      </div>

      <div className={`BunError-error-message`}>{title}</div>

      {subtitle.length > 0 && (
        <div className={`BunError-error-subtitle`}>{subtitle}</div>
      )}

      {message.data.location && (
        <BuildErrorStackTrace location={message.data.location} />
      )}
    </div>
  );
};

const ResolveError = ({ message }: { message: Message }) => {
  const { cwd } = useContext(ErrorGroupContext);
  let title = (message.data.text || "").trim();
  const newline = title.indexOf("\n");
  let subtitle = null;
  if (newline > -1) {
    subtitle = title.slice(newline + 1).trim();
    title = title.slice(0, newline);
  }

  return (
    <div className={`BunError-BuildError BunError-BuildError--resolve`}>
      <div className="BunError-error-header">
        <div className={`BunError-error-code`}>ResolveError</div>
      </div>

      <div className={`BunError-error-message`}>
        Can't import{" "}
        <span className="BunError-error-message--mono">
          {message.on.resolve}
        </span>
      </div>

      {subtitle && <div className={`BunError-error-subtitle`}>{subtitle}</div>}

      {message.data.location && (
        <BuildErrorStackTrace location={message.data.location} />
      )}
    </div>
  );
};
const OverlayMessageContainer = ({
  problems,
  reason,
  router,
}: FallbackMessageContainer) => {
  return (
    <div id="BunErrorOverlay-container">
      <div className="BunError-content">
        <div className="BunError-header">
          <Summary
            errorCount={problems.exceptions.length + problems.build.errors}
            onClose={onClose}
            problems={problems}
            reason={reason}
          />
        </div>
        <div className={`BunError-list`}>
          {problems.exceptions.map((problem, index) => (
            <JSException key={index} value={problem} />
          ))}
          {problems.build.msgs.map((buildMessage, index) => {
            if (buildMessage.on.build) {
              return <BuildError key={index} message={buildMessage} />;
            } else if (buildMessage.on.resolve) {
              return <ResolveError key={index} message={buildMessage} />;
            } else {
              throw new Error("Unknown build message type");
            }
          })}
        </div>
        <div className="BunError-footer">
          <div id="BunError-poweredBy"></div>
        </div>
      </div>
    </div>
  );
};

const BuildFailureMessageContainer = ({
  messages,
}: {
  messages: Message[];
}) => {
  return (
    <div id="BunErrorOverlay-container">
      <div className="BunError-content">
        <div className="BunError-header">
          <Summary onClose={onClose} errorCount={messages.length} />
        </div>
        <div className={`BunError-list`}>
          {messages.map((buildMessage, index) => {
            if (buildMessage.on.build) {
              return <BuildError key={index} message={buildMessage} />;
            } else if (buildMessage.on.resolve) {
              return <ResolveError key={index} message={buildMessage} />;
            } else {
              throw new Error("Unknown build message type");
            }
          })}
        </div>
        <div className="BunError-footer">
          <div id="BunError-poweredBy"></div>
        </div>
      </div>
    </div>
  );
};

const ErrorGroupContext = createContext<{ cwd: string }>(null);
var reactRoot;

function renderWithFunc(func) {
  if (!reactRoot) {
    const root = document.createElement("div");
    root.id = "__bun__error-root";

    reactRoot = document.createElement("div");
    reactRoot.id = BUN_ERROR_CONTAINER_ID;
    reactRoot.style.visibility = "hidden";
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL("/bun:erro.css", document.baseURI).href;
    link.onload = () => {
      reactRoot.style.visibility = "visible";
    };

    const shadowRoot = root.attachShadow({ mode: "open" });
    shadowRoot.appendChild(link);
    shadowRoot.appendChild(reactRoot);

    document.body.appendChild(root);
    ReactDOM.render(func(), reactRoot);

    debugger;
  } else {
    ReactDOM.render(func(), reactRoot);
  }
}

export function renderFallbackError(fallback: FallbackMessageContainer) {
  return renderWithFunc(() => (
    <ErrorGroupContext.Provider value={fallback}>
      <OverlayMessageContainer {...fallback} />
    </ErrorGroupContext.Provider>
  ));
}

export function dismissError() {
  if (reactRoot) {
    ReactDOM.unmountComponentAtNode(reactRoot);
    const root = document.getElementById("__bun__error-root");
    if (root) root.remove();
    reactRoot = null;
  }
}

globalThis.renderBuildFailure = (
  failure: WebsocketMessageBuildFailure,
  cwd: string
) => {
  renderWithFunc(() => (
    <ErrorGroupContext.Provider value={{ cwd }}>
      <BuildFailureMessageContainer messages={failure.log.msgs} />
    </ErrorGroupContext.Provider>
  ));
};
