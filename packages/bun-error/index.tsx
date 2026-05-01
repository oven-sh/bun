import type { JSX } from "preact";
import { createContext, render } from "preact";
import { useCallback, useContext, useEffect, useRef, useState } from "preact/hooks";
import type {
  FallbackMessageContainer,
  JSException,
  JSException as JSExceptionType,
  Location,
  Message,
  SourceLine,
  StackFrame,
  WebsocketMessageBuildFailure,
} from "../../src/api/schema";
import { messagesToMarkdown, problemsToMarkdown, withBunInfo } from "./markdown";
import { fetchAllMappings, remapPosition, sourceMappings } from "./sourcemap";

export enum StackFrameScope {
  Eval = 1,
  Module = 2,
  Function = 3,
  Global = 4,
  Wasm = 5,
  Constructor = 6,
}

export enum JSErrorCode {
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
  <div className={`BunError-ErrorTag BunError-ErrorTag--${ErrorTagType[type]}`}>{ErrorTagType[type]}</div>
);

const errorTags = [
  <ErrorTag type={ErrorTagType.build}></ErrorTag>,
  <ErrorTag type={ErrorTagType.resolve}></ErrorTag>,
  <ErrorTag type={ErrorTagType.server}></ErrorTag>,
  <ErrorTag type={ErrorTagType.client}></ErrorTag>,
  <ErrorTag type={ErrorTagType.hmr}></ErrorTag>,
];

function getAssetPrefixPath() {
  return globalThis["__BUN_HMR"]?.assetPrefixPath || "";
}

export const normalizedFilename = (filename: string, cwd?: string): string => {
  if (filename.startsWith("http://") || filename.startsWith("https://")) {
    const url = new URL(filename, globalThis.location.href);
    if (url.origin === globalThis.location.origin) {
      filename = url.pathname;
    }
  }

  var blobI = filename.indexOf("/blob:");
  if (blobI > -1) {
    filename = filename.substring(blobI + "/blob:".length);
  }

  const assetPrefixPath = getAssetPrefixPath();

  if (cwd && filename.startsWith(cwd)) {
    filename = filename.substring(cwd.length);

    if (assetPrefixPath.length > 0 && filename.startsWith(assetPrefixPath)) {
      return filename.substring(assetPrefixPath.length);
    }
  }

  if (assetPrefixPath.length > 0 && filename.startsWith(assetPrefixPath)) {
    return filename.substring(assetPrefixPath.length);
  }

  return filename;
};

function hasColumnOrLine(filename: string) {
  return /:\d+/.test(filename);
}

function appendLineColumnIfNeeded(base: string, line?: number, column?: number) {
  if (hasColumnOrLine(base)) return base;

  return appendLineColumn(base, line, column);
}

function appendLineColumn(base: string, line?: number, column?: number) {
  if (Number.isFinite(line)) {
    base += `:${line}`;

    if (Number.isFinite(column)) {
      base += `:${column}`;
    }
  }

  return base;
}

const blobFileURL = (filename: string, line?: number, column?: number): string => {
  var base = `/blob:${filename}`;

  base = appendLineColumnIfNeeded(base, line, column);

  return new URL(base, globalThis.location.href).href;
};

const maybeBlobFileURL = (filename: string, line?: number, column?: number): string => {
  if (filename.includes(".bun")) {
    return blobFileURL(filename, line, column);
  }

  if (filename.includes("blob:")) {
    return appendLineColumnIfNeeded(filename, line, column);
  }

  return srcFileURL(filename, line, column);
};

const openWithoutFlashOfNewTab: JSX.MouseEventHandler<HTMLAnchorElement> = event => {
  const target = event.currentTarget as HTMLAnchorElement;
  const href = target.getAttribute("href");
  if (!href || event.button !== 0) {
    return true;
  }

  event.preventDefault();
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const headers = new Headers();
  headers.set("Accept", "text/plain");

  if (target.dataset.line) {
    headers.set("Editor-Line", target.dataset.line);
  }

  if (target.dataset.column) {
    headers.set("Editor-Column", target.dataset.column);
  }

  headers.set("Open-In-Editor", "1");

  globalThis
    .fetch(href.split("?")[0], {
      headers: headers,
    })
    .then(
      () => {},
      er => {},
    );
  return false;
};

const srcFileURL = (filename: string, line?: number, column?: number): string => {
  if (filename.startsWith("http://") || filename.startsWith("https://")) return appendLineColumnIfNeeded(filename);

  if (filename.endsWith(".bun")) {
    return new URL("/" + filename, globalThis.location.href).href;
  }

  if (!filename.startsWith("/") && thisCwd) {
    var orig = filename;
    filename = thisCwd;
    if (thisCwd.endsWith("/")) {
      filename += orig;
    } else {
      filename += "/" + orig;
    }
  }

  var base = `/src:${filename}`;
  base = appendLineColumnIfNeeded(base, line, column);

  return new URL(base, globalThis.location.href).href;
};

class FancyTypeError {
  constructor(exception: JSException) {
    this.runtimeType = exception.runtime_type || 0;
    this.runtimeTypeName = RuntimeType[this.runtimeType] || "undefined";
    this.message = exception.message || "";
    this.explain = "";

    this.normalize(exception);
  }

  runtimeType: RuntimeType;
  explain: string;
  runtimeTypeName: string;
  message: string;

  normalize(exception: JSException) {
    if (!exception.message) return;
    const i = exception.message.lastIndexOf(" is ");
    if (i === -1) return;
    const partial = exception.message.substring(i + " is ".length);
    const nextWord = /(["a-zA-Z0-9_\.]+)\)$/.exec(partial);
    if (nextWord && nextWord[0]) {
      this.runtimeTypeName = nextWord[0];
      this.runtimeTypeName = this.runtimeTypeName.substring(0, this.runtimeTypeName.length - 1);
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
      this.message = this.message.substring(0, this.message.lastIndexOf("(In "));
    }
  }
}

export const clientURL = filename => {
  if (filename.includes(".bun")) {
    return `/${filename.replace(/^(\/)?/g, "")}`;
  }

  // Since bun has source maps now, we assume that it will we are dealing with a src url
  return srcFileURL(filename);
};

const IndentationContext = createContext(0);

enum LoadState {
  pending,
  loaded,
  failed,
}

const AsyncSourceLines = ({
  highlight = -1,
  highlightColumnStart = 0,
  highlightColumnEnd = Infinity,
  children,
  buildURL,
  sourceLines,
  setSourceLines,
}: {
  highlight: number;
  highlightColumnStart: number;
  highlightColumnEnd: number;
  children?: any;
  buildURL: (line?: number, column?: number) => string;
  sourceLines: SourceLine[];
  setSourceLines: (lines: SourceLine[]) => void;
}) => {
  const [loadState, setLoadState] = useState(LoadState.pending);

  const controller = useRef<AbortController | null>(null);
  const url = useRef<string>(buildURL(0, 0));

  useEffect(() => {
    controller.current = new AbortController();
    var cancelled = false;
    fetch(url.current, {
      signal: controller.current.signal,
      headers: {
        Accept: "text/plain",
      },
    })
      .then(resp => {
        return resp.text();
      })
      .then(text => {
        if (cancelled) return;

        // TODO: make this faster
        const lines = text.split("\n");
        const startLineNumber = Math.max(Math.min(Math.max(highlight - 4, 0), lines.length - 1), 0);
        const endLineNumber = Math.min(startLineNumber + 8, lines.length);
        const sourceLines: SourceLine[] = new Array(endLineNumber - startLineNumber);
        var index = 0;
        for (let i = startLineNumber; i < endLineNumber; i++) {
          const currentLine = lines[i - 1];
          if (typeof currentLine === "undefined") break;
          sourceLines[index++] = {
            line: i,
            text: currentLine,
          };
        }

        setSourceLines(index !== sourceLines.length ? sourceLines.slice(0, index) : sourceLines);
        setLoadState(LoadState.loaded);
      })
      .catch(err => {
        if (!cancelled) {
          console.error(err);
          setLoadState(LoadState.failed);
        }
      });
    return () => {
      cancelled = true;
      if (controller.current) {
        controller.current.abort();
        controller.current = null;
      }
    };
  }, [controller, setLoadState, setSourceLines, url, highlight]);

  switch (loadState) {
    case LoadState.pending: {
      return (
        <div className="BunError-SourceLines">
          <div className="BunError-SourceLines-numbers">
            <div></div>
            <div></div>
            <div></div>
            <div></div>
            <div></div>
          </div>
          <div className="BunError-SourceLines-lines">
            <div></div>
            <div></div>
            <div></div>
            <div></div>
            <div></div>
          </div>
        </div>
      );
    }

    case LoadState.failed: {
      return null;
    }

    case LoadState.loaded: {
      return (
        <SourceLines
          highlight={highlight}
          highlightColumnStart={highlightColumnStart}
          highlightColumnEnd={highlightColumnEnd}
          buildURL={buildURL}
          sourceLines={sourceLines}
        >
          {children}
        </SourceLines>
      );
    }
    default: {
      throw new Error("Invalid state");
    }
  }
};

const SourceLines = ({
  sourceLines,
  highlight = -1,
  highlightColumnStart = 0,
  highlightColumnEnd = Infinity,
  children,
  buildURL,
}: {
  sourceLines: SourceLine[];
  highlight: number;
  highlightColumnStart: number;
  highlightColumnEnd: number;
  children?: any;
  buildURL: (line?: number, column?: number) => string;
}) => {
  let start = sourceLines.length;
  let end = 0;
  let dedent = Infinity;
  let _i = 0;
  var minLineNumber = sourceLines.length + highlight + 1;
  var maxLineNumber = 0;
  for (let i = 0; i < sourceLines.length; i++) {
    // bun only prints \n, no \r\n, so this should work fine
    sourceLines[i].text = sourceLines[i].text.replaceAll("\n", "");

    // This will now only trim spaces (and vertical tab character which never prints)
    const left = sourceLines[i].text.trimStart();
    minLineNumber = Math.min(sourceLines[i].line, minLineNumber);
    maxLineNumber = Math.max(sourceLines[i].line, maxLineNumber);

    if (left.length > 0) {
      start = Math.min(start, i);
      end = Math.max(end, i + 1);

      dedent = Math.min(sourceLines[i].text.length - left.length, dedent);
    }
  }

  const leftPad = maxLineNumber.toString(10).length - minLineNumber.toString(10).length;

  const _sourceLines = sourceLines.slice(start, end);
  const lines = new Array(_sourceLines.length + (Array.isArray(children) ? children.length : children ? 1 : 0));

  let highlightI = 0;
  for (let i = 0; i < _sourceLines.length; i++) {
    const { line, text } = _sourceLines[i];
    const classes = {
      empty: text.trim().length === 0,
      highlight: highlight === line,
    };
    if (classes.highlight) highlightI = i;
    const _text = classes.empty ? "" : text.substring(dedent);
    lines[i] = (
      <div className="BunError-SourceLine" key={"line-" + i}>
        <a
          data-line={line}
          data-column={classes.highlight ? highlightColumnStart : dedent}
          title={`Open line ${line} in editor`}
          href={buildURL(line, classes.highlight ? highlightColumnStart : dedent)}
          onClickCapture={openWithoutFlashOfNewTab}
          key={"highlight-number-" + line}
          className={`BunError-SourceLine-number ${classes.empty ? "BunError-SourceLine-number--empty" : ""} ${
            classes.highlight ? "BunError-SourceLine-number--highlight" : ""
          }`}
        >
          {line.toString(10).padStart(leftPad, " ")}
        </a>
        <div
          tabIndex={i}
          className={`BunError-SourceLine-text ${classes.empty ? "BunError-SourceLine-text--empty" : ""} ${
            classes.highlight ? "BunError-SourceLine-text--highlight" : ""
          }`}
        >
          {_text}
        </div>
      </div>
    );
  }

  return (
    <IndentationContext.Provider value={dedent}>
      <div className="BunError-SourceLines">
        <div className={`BunError-SourceLines-highlighter--${highlightI}`}></div>

        {lines}
      </div>
    </IndentationContext.Provider>
  );
};

const BuildErrorSourceLines = ({ location, filename }: { location: Location; filename: string }) => {
  const { line, line_text, column } = location;
  const sourceLines: SourceLine[] = [{ line, text: line_text }];
  const buildURL = useCallback((line, column) => srcFileURL(filename, line, column), [filename]);
  return (
    <SourceLines
      sourceLines={sourceLines}
      highlight={line}
      buildURL={buildURL}
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
        onClick={openWithoutFlashOfNewTab}
        className="BunError-NativeStackTrace-filename"
      >
        {filename}:{line}:{column}
      </a>
      <BuildErrorSourceLines filename={filename} location={location} />
    </div>
  );
};

export const StackFrameIdentifier = ({
  functionName,
  scope,
  markdown = false,
}: {
  functionName?: string;
  markdown: boolean;
  scope: StackFrameScope;
}) => {
  switch (scope) {
    case StackFrameScope.Constructor: {
      functionName = markdown && functionName ? "`" + functionName + "`" : functionName;
      return functionName ? `new ${functionName}` : "new (anonymous)";
    }

    case StackFrameScope.Eval: {
      return "eval";
    }

    case StackFrameScope.Module: {
      return "(esm)";
    }

    case StackFrameScope.Global: {
      return "(global)";
    }

    case StackFrameScope.Wasm: {
      return "(wasm)";
    }

    case StackFrameScope.Function:
    default: {
      return functionName ? (markdown ? "`" + functionName + "`" : functionName) : "λ()";
    }
  }
};

const getNativeStackFrameIdentifier = frame => {
  const { file, function_name: functionName, scope } = frame;

  return StackFrameIdentifier({
    functionName,
    scope,
    markdown: false,
  });
};

const NativeStackFrame = ({
  frame,
  maxLength,
  urlBuilder,
}: {
  frame: StackFrame;
  maxLength: number;
  urlBuilder: typeof maybeBlobFileURL;
}) => {
  const { cwd } = useContext(ErrorGroupContext);
  const {
    file,
    function_name: functionName,
    position: { line, column },
    scope,
  } = frame;
  const fileName = normalizedFilename(file, cwd);
  return (
    <div className={`BunError-StackFrame ${fileName.endsWith(".bun") ? "BunError-StackFrame--muted" : ""}`}>
      <div
        title={StackFrameScope[scope]}
        className="BunError-StackFrame-identifier"
        style={{ "--max-length": `${maxLength}ch` }}
      >
        {getNativeStackFrameIdentifier(frame)}
      </div>

      <a
        target="_blank"
        href={urlBuilder(fileName, line, column)}
        data-line={line}
        data-column={column}
        onClick={openWithoutFlashOfNewTab}
        className="BunError-StackFrame-link"
        title="Open in editor"
        draggable={false}
      >
        <div className="BunError-StackFrame-link-content">
          <div className={`BunError-StackFrame-file`}>{fileName}</div>
          {line > -1 && <div className="BunError-StackFrame-line">:{line}</div>}
          {column > -1 && <div className="BunError-StackFrame-column">:{column}</div>}
        </div>
      </a>
    </div>
  );
};

const NativeStackFrames = ({ frames, urlBuilder }) => {
  const items = new Array(frames.length);
  var maxLength = 0;

  for (let i = 0; i < frames.length; i++) {
    maxLength = Math.max(getNativeStackFrameIdentifier(frames[i]).length, maxLength);
  }

  for (let i = 0; i < frames.length; i++) {
    items[i] = <NativeStackFrame maxLength={maxLength} urlBuilder={urlBuilder} key={i} frame={frames[i]} />;
  }

  return (
    <div className="BunError-StackFrames-container">
      <div className="BunError-StackFrames">{items}</div>
    </div>
  );
};

const NativeStackTrace = ({
  frames,
  sourceLines,
  setSourceLines,
  children,
  isClient = false,
}: {
  frames: StackFrame[];
  sourceLines: SourceLine[];
  setSourceLines: (sourceLines: SourceLine[]) => void;
  children?: any;
  isClient: boolean;
}) => {
  const { file = "", position } = frames[0];
  const { cwd } = useContext(ErrorGroupContext);
  const filename = normalizedFilename(file, cwd);
  const urlBuilder = isClient ? clientURL : maybeBlobFileURL;
  const ref = useRef<HTMLDivElement>(null);
  const buildURL = useCallback((line, column) => urlBuilder(file, line, column), [file, urlBuilder]);

  return (
    <div ref={ref} className={`BunError-NativeStackTrace`}>
      <a
        href={urlBuilder(filename, position.line, position.column)}
        data-line={position.line}
        data-column={position.column}
        data-is-client="true"
        target="_blank"
        onClick={openWithoutFlashOfNewTab}
        className="BunError-NativeStackTrace-filename"
      >
        {filename}:{position.line}:{position.column}
      </a>
      {sourceLines.length > 0 && (
        <SourceLines
          highlight={position.line}
          sourceLines={sourceLines}
          highlightColumnStart={position.column}
          buildURL={buildURL}
          highlightColumnEnd={position.column_stop}
        >
          {children}
        </SourceLines>
      )}
      {sourceLines.length === 0 && (
        <AsyncSourceLines
          highlight={position.line}
          sourceLines={sourceLines}
          setSourceLines={setSourceLines}
          highlightColumnStart={position.column}
          buildURL={buildURL}
          highlightColumnEnd={position.column_stop}
        >
          {children}
        </AsyncSourceLines>
      )}
      {frames.length > 1 && <NativeStackFrames urlBuilder={urlBuilder} frames={frames} />}
    </div>
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

const JSException = ({ value, isClient = false }: { value: JSExceptionType; isClient: boolean }) => {
  const tag = isClient ? ErrorTagType.client : ErrorTagType.server;
  const [sourceLines, _setSourceLines] = useState(value?.stack?.source_lines ?? []);
  var message = value.message || "";
  var name = value.name || "";
  if (!name && !message) {
    name = `Unknown error`;
  }

  // mutating a prop is sacrilege
  function setSourceLines(sourceLines: SourceLine[]) {
    _setSourceLines(sourceLines);
    if (!value.stack) {
      value.stack = {
        frames: [],
        source_lines: sourceLines,
      };
    } else {
      value.stack.source_lines = sourceLines;
    }
  }
  switch (value.code) {
    case JSErrorCode.TypeError: {
      const fancyTypeError = new FancyTypeError(value);

      if (fancyTypeError.runtimeType !== RuntimeType.Nothing) {
        return (
          <div className={`BunError-JSException BunError-JSException--TypeError`}>
            <div className="BunError-error-header">
              <div className={`BunError-error-code`}>TypeError</div>
              {errorTags[tag]}
            </div>

            <div className={`BunError-error-message`}>{fancyTypeError.message}</div>

            {fancyTypeError.runtimeTypeName.length && (
              <div className={`BunError-error-subtitle`}>
                It's <span className="BunError-error-typename">{fancyTypeError.runtimeTypeName}</span>.
              </div>
            )}

            {value.stack && (
              <NativeStackTrace
                frames={value.stack.frames}
                isClient={isClient}
                sourceLines={sourceLines}
                setSourceLines={setSourceLines}
              >
                <Indent by={value.stack.frames[0].position.column}>
                  <span className="BunError-error-typename">{fancyTypeError.runtimeTypeName}</span>
                </Indent>
              </NativeStackTrace>
            )}
          </div>
        );
      }
    }

    default: {
      const newline = message.indexOf("\n");
      if (newline > -1) {
        const subtitle = message.substring(newline + 1).trim();
        message = message.substring(0, newline).trim();
        if (subtitle.length) {
          return (
            <div className={`BunError-JSException`}>
              <div className="BunError-error-header">
                <div className={`BunError-error-code`}>{name}</div>
                {errorTags[tag]}
              </div>

              <div className={`BunError-error-message`}>{message}</div>
              <div className={`BunError-error-subtitle`}>{subtitle}</div>

              {value.stack && (
                <NativeStackTrace
                  frames={value.stack.frames}
                  isClient={isClient}
                  sourceLines={sourceLines}
                  setSourceLines={setSourceLines}
                />
              )}
            </div>
          );
        }
      }

      return (
        <div className={`BunError-JSException`}>
          <div className="BunError-error-header">
            <div className={`BunError-error-code`}>{name}</div>
            {errorTags[tag]}
          </div>

          <div className={`BunError-error-message`}>{message}</div>

          {value.stack && (
            <NativeStackTrace
              isClient={isClient}
              frames={value.stack.frames}
              sourceLines={sourceLines}
              setSourceLines={setSourceLines}
            />
          )}
        </div>
      );
    }
  }
};

const Summary = ({ errorCount, onClose }: { errorCount: number; onClose: () => void }) => {
  return (
    <div className="BunError-Summary">
      <div className="BunError-Summary-ErrorIcon"></div>
      <div className="BunError-Summary-Title">
        {errorCount}&nbsp;error{errorCount > 1 ? "s" : ""}&nbsp;on this page
      </div>

      <a href="https://bun.com/discord" target="_blank" className="BunError-Summary-help">
        <svg width="18" viewBox="0 0 71 55" fill="none" xmlns="http://www.w3.org/2000/svg">
          <g clipPath="url(#clip0)">
            <path
              d="M60.1045 4.8978C55.5792 2.8214 50.7265 1.2916 45.6527 0.41542C45.5603 0.39851 45.468 0.440769 45.4204 0.525289C44.7963 1.6353 44.105 3.0834 43.6209 4.2216C38.1637 3.4046 32.7345 3.4046 27.3892 4.2216C26.905 3.0581 26.1886 1.6353 25.5617 0.525289C25.5141 0.443589 25.4218 0.40133 25.3294 0.41542C20.2584 1.2888 15.4057 2.8186 10.8776 4.8978C10.8384 4.9147 10.8048 4.9429 10.7825 4.9795C1.57795 18.7309 -0.943561 32.1443 0.293408 45.3914C0.299005 45.4562 0.335386 45.5182 0.385761 45.5576C6.45866 50.0174 12.3413 52.7249 18.1147 54.5195C18.2071 54.5477 18.305 54.5139 18.3638 54.4378C19.7295 52.5728 20.9469 50.6063 21.9907 48.5383C22.0523 48.4172 21.9935 48.2735 21.8676 48.2256C19.9366 47.4931 18.0979 46.6 16.3292 45.5858C16.1893 45.5041 16.1781 45.304 16.3068 45.2082C16.679 44.9293 17.0513 44.6391 17.4067 44.3461C17.471 44.2926 17.5606 44.2813 17.6362 44.3151C29.2558 49.6202 41.8354 49.6202 53.3179 44.3151C53.3935 44.2785 53.4831 44.2898 53.5502 44.3433C53.9057 44.6363 54.2779 44.9293 54.6529 45.2082C54.7816 45.304 54.7732 45.5041 54.6333 45.5858C52.8646 46.6197 51.0259 47.4931 49.0921 48.2228C48.9662 48.2707 48.9102 48.4172 48.9718 48.5383C50.038 50.6034 51.2554 52.5699 52.5959 54.435C52.6519 54.5139 52.7526 54.5477 52.845 54.5195C58.6464 52.7249 64.529 50.0174 70.6019 45.5576C70.6551 45.5182 70.6887 45.459 70.6943 45.3942C72.1747 30.0791 68.2147 16.7757 60.1968 4.9823C60.1772 4.9429 60.1437 4.9147 60.1045 4.8978ZM23.7259 37.3253C20.2276 37.3253 17.3451 34.1136 17.3451 30.1693C17.3451 26.225 20.1717 23.0133 23.7259 23.0133C27.308 23.0133 30.1626 26.2532 30.1066 30.1693C30.1066 34.1136 27.28 37.3253 23.7259 37.3253ZM47.3178 37.3253C43.8196 37.3253 40.9371 34.1136 40.9371 30.1693C40.9371 26.225 43.7636 23.0133 47.3178 23.0133C50.9 23.0133 53.7545 26.2532 53.6986 30.1693C53.6986 34.1136 50.9 37.3253 47.3178 37.3253Z"
              fill="#5865F2"
            />
          </g>
          <defs>
            <clipPath id="clip0">
              <rect width="71" height="55" fill="white" />
            </clipPath>
          </defs>
        </svg>
        Want help?
      </a>

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

      {subtitle.length > 0 && <div className={`BunError-error-subtitle`}>{subtitle}</div>}

      {message.data.location && <BuildErrorStackTrace location={message.data.location} />}
    </div>
  );
};

const ResolveError = ({ message }: { message: Message }) => {
  const { cwd } = useContext(ErrorGroupContext);
  let title = (message.data.text || "").trim();
  const newline = title.indexOf("\n");
  let subtitle: string | null = null;
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
        <span className="BunError-error-message--mono BunError-error-message--quoted">"{message.on.resolve}"</span>
      </div>

      {subtitle && <div className={`BunError-error-subtitle`}>{subtitle}</div>}

      {message.data.location && <BuildErrorStackTrace location={message.data.location} />}
    </div>
  );
};
const OverlayMessageContainer = ({
  problems,
  reason,
  isClient = false,
}: FallbackMessageContainer & { isClient: boolean }) => {
  const errorCount = problems ? problems.exceptions.length + problems.build.errors : 0;
  return (
    <div id="BunErrorOverlay-container">
      <div className="BunError-content">
        <div className="BunError-header">
          <Summary errorCount={errorCount} onClose={dismissError} />
        </div>
        <div className={`BunError-list`}>
          {problems?.exceptions.map((problem, index) => (
            <JSException isClient={isClient} key={index} value={problem} />
          ))}
          {problems?.build.msgs.map((buildMessage, index) => {
            if (buildMessage.on.build) {
              return <BuildError key={index} message={buildMessage} />;
            } else if (buildMessage.on.resolve) {
              return <ResolveError key={index} message={buildMessage} />;
            } else {
              throw new Error("Unknown build message type");
            }
          })}
        </div>
        <Footer toMarkdown={problemsToMarkdown} data={problems} />
      </div>
    </div>
  );
};

// we can ignore the synchronous copy to clipboard API...I think
function copyToClipboard(input: string | Promise<string>) {
  if (!input) return;

  if (typeof input === "object" && "then" in input) {
    return input.then(str => copyToClipboard(str));
  }

  return navigator.clipboard.writeText(input).then(() => {});
}

const Footer = ({ toMarkdown, data }) => (
  <div className="BunError-footer">
    <div
      title="Copy error as markdown so it can be pasted into a bug report or slack/discord"
      aria-label="Copy as markdown button"
      className="BunErrror-footerItem BunError-CopyButton"
      onClick={() => copyToClipboard(withBunInfo(String(toMarkdown(data))))}
    >
      <svg width="24" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
        <path d="M502.6 70.63l-61.25-61.25C435.4 3.371 427.2 0 418.7 0H255.1c-35.35 0-64 28.66-64 64l.0195 256C192 355.4 220.7 384 256 384h192c35.2 0 64-28.8 64-64V93.25C512 84.77 508.6 76.63 502.6 70.63zM464 320c0 8.836-7.164 16-16 16H255.1c-8.838 0-16-7.164-16-16L239.1 64.13c0-8.836 7.164-16 16-16h128L384 96c0 17.67 14.33 32 32 32h47.1V320zM272 448c0 8.836-7.164 16-16 16H63.1c-8.838 0-16-7.164-16-16L47.98 192.1c0-8.836 7.164-16 16-16H160V128H63.99c-35.35 0-64 28.65-64 64l.0098 256C.002 483.3 28.66 512 64 512h192c35.2 0 64-28.8 64-64v-32h-47.1L272 448z"></path>
      </svg>{" "}
      Copy as markdown
    </div>
    <div className="BunErrror-footerItem" id="BunError-poweredBy"></div>
  </div>
);

const BuildFailureMessageContainer = ({ messages }: { messages: Message[] }) => {
  return (
    <div id="BunErrorOverlay-container">
      <div className="BunError-content">
        <div className="BunError-header">
          <Summary onClose={dismissError} errorCount={messages.length} />
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
        <Footer toMarkdown={messagesToMarkdown} data={messages} />
      </div>
    </div>
  );
};
export var thisCwd = "";
const ErrorGroupContext = createContext<{ cwd?: string }>({ cwd: undefined });
var reactRoot;

function renderWithFunc(func) {
  if (!reactRoot) {
    const root = document.createElement("div");
    root.id = "__bun__error-root";

    reactRoot = document.createElement("div");
    reactRoot.id = BUN_ERROR_CONTAINER_ID;

    const fallbackStyleSheet = document.querySelector("style[data-has-bun-fallback-style]");
    if (!fallbackStyleSheet) {
      reactRoot.style.visibility = "hidden";
    }
    const shadowRoot = root.attachShadow({ mode: "closed" });
    if (!fallbackStyleSheet) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = new URL("/bun:erro.css", document.baseURI).href;
      link.onload = () => {
        reactRoot.style.visibility = "visible";
      };
      shadowRoot.appendChild(link);
    } else {
      fallbackStyleSheet.remove();
      shadowRoot.appendChild(fallbackStyleSheet);
      reactRoot.classList.add("BunErrorRoot--FullPage");

      const page = document.querySelector("style[data-bun-error-page-style]");
      if (page) {
        page.remove();
        shadowRoot.appendChild(page);
      }
    }

    shadowRoot.appendChild(reactRoot);

    document.body.appendChild(root);
    render(func(), reactRoot);
  } else {
    render(func(), reactRoot);
  }
}

export function renderFallbackError(fallback: FallbackMessageContainer) {
  if (fallback && fallback.cwd) {
    thisCwd = fallback.cwd;
  }
  // Not an error
  if (fallback?.problems?.name === "JSDisabled") return;

  return renderWithFunc(() => (
    <ErrorGroupContext.Provider value={fallback}>
      <OverlayMessageContainer isClient {...fallback} />
    </ErrorGroupContext.Provider>
  ));
}

globalThis[Symbol.for("Bun__renderFallbackError")] = renderFallbackError;

import { parse as getStackTrace } from "./stack-trace-parser";
var runtimeErrorController: AbortController | null = null;
var pending: { stopped: boolean }[] = [];

var onIdle = globalThis.requestIdleCallback || (cb => setTimeout(cb, 32));
function clearSourceMappings() {
  sourceMappings.clear();
}
export function renderRuntimeError(error: Error) {
  runtimeErrorController = new AbortController();
  if (typeof error === "string") {
    error = {
      name: "Error",
      message: error,
    };
  }

  const exception = {
    name: String(error.name),
    message: String(error.message),
    runtime_type: 0,
    stack: {
      frames: error.stack ? getStackTrace(error.stack) : [],
      source_lines: [],
    },
  };

  var lineNumberProperty = "";
  var columnNumberProperty = "";
  var fileNameProperty = "";

  if (error && typeof error === "object") {
    // safari
    if ("line" in error) {
      lineNumberProperty = "line";
      // firefox
    } else if ("lineNumber" in error) {
      lineNumberProperty = "lineNumber";
    }

    // safari
    if ("column" in error) {
      columnNumberProperty = "column";
      // firefox
    } else if ("columnNumber" in error) {
      columnNumberProperty = "columnNumber";
    }

    // safari
    if ("sourceURL" in error) {
      fileNameProperty = "sourceURL";
      // firefox
    } else if ("fileName" in error) {
      fileNameProperty = "fileName";
    }
  }

  if (Number.isFinite(error[lineNumberProperty])) {
    if (exception.stack?.frames.length == 0) {
      exception.stack.frames.push({
        file: error[fileNameProperty] || "",
        position: {
          line: +error[lineNumberProperty] || 1,
          column: +error[columnNumberProperty] || 1,
        },
      } as StackFrame);
    } else if (exception.stack && exception.stack.frames.length > 0) {
      exception.stack.frames[0].position.line = error[lineNumberProperty];

      if (Number.isFinite(error[columnNumberProperty])) {
        exception.stack.frames[0].position.column = error[columnNumberProperty];
      }
    }
  }
  const signal = runtimeErrorController.signal;

  const fallback: FallbackMessageContainer = {
    message: error.message,

    problems: {
      build: {
        warnings: 0,
        errors: 0,
        msgs: [],
      },
      code: 0,
      name: error.name,
      exceptions: [exception],
    },
  };

  var stopThis = { stopped: false };
  pending.push(stopThis);

  const BunError = () => {
    return (
      <ErrorGroupContext.Provider value={fallback}>
        <OverlayMessageContainer isClient {...fallback} />
      </ErrorGroupContext.Provider>
    );
  };

  // Remap the sourcemaps
  // But! If we've already fetched the source mappings in this page load before
  // Rely on the cached ones
  // and don't fetch them again
  const framePromises = fetchAllMappings(
    exception.stack.frames.map(frame => normalizedFilename(frame.file, thisCwd)),
    signal,
  )
    .map((frame, i) => {
      if (stopThis.stopped) return null;
      return [frame, i];
    })
    .map(result => {
      if (!result) return;
      const [mappings, frameIndex] = result;
      if (mappings?.then) {
        return mappings.then(mappings => {
          if (!mappings || stopThis.stopped) {
            return null;
          }
          var frame = exception.stack.frames[frameIndex];

          const { line, column } = frame.position;
          const remapped = remapPosition(mappings, line, column);
          if (!remapped) return null;
          frame.position.line_start = frame.position.line = remapped[0];
          frame.position.column_stop =
            frame.position.expression_stop =
            frame.position.expression_start =
            frame.position.column =
              remapped[1];
        }, console.error);
      } else {
        if (!mappings) return null;
        var frame = exception.stack.frames[frameIndex];
        const { line, column } = frame.position;
        const remapped = remapPosition(mappings, line, column);
        if (!remapped) return null;
        frame.position.line_start = frame.position.line = remapped[0];
        frame.position.column_stop =
          frame.position.expression_stop =
          frame.position.expression_start =
          frame.position.column =
            remapped[1];
      }
    });

  var anyPromises = false;
  for (let i = 0; i < framePromises.length; i++) {
    if (framePromises[i] && framePromises[i].then) {
      anyPromises = true;
      break;
    }
  }

  if (anyPromises) {
    Promise.allSettled(framePromises).finally(() => {
      if (stopThis.stopped || signal.aborted) return;
      onIdle(clearSourceMappings);
      return renderWithFunc(() => {
        return <BunError />;
      });
    });
  } else {
    onIdle(clearSourceMappings);
    renderWithFunc(() => {
      return <BunError />;
    });
  }
}

export function dismissError() {
  if (reactRoot) {
    render(null, reactRoot);
    const root = document.getElementById("__bun__error-root");
    if (root) root.remove();
    reactRoot = null;
    if (runtimeErrorController) {
      runtimeErrorController.abort();
      runtimeErrorController = null;
    }

    while (pending.length > 0) pending.shift().stopped = true;
  }
}

export const renderBuildFailure = (failure: WebsocketMessageBuildFailure, cwd: string) => {
  thisCwd = cwd;
  renderWithFunc(() => (
    <ErrorGroupContext.Provider value={{ cwd }}>
      <BuildFailureMessageContainer messages={failure.log.msgs} />
    </ErrorGroupContext.Provider>
  ));
};

export const clearBuildFailure = dismissError;
globalThis.__BunClearBuildFailure = dismissError;
