const UNKNOWN_FUNCTION = "<unknown>";
import type { StackFrame } from "../../src/api/schema";

/**
 * This parses the different stack traces and puts them into one format
 * This borrows heavily from TraceKit (https://github.com/csnover/TraceKit)
 */
export function parse(stackString): StackFrame[] {
  const lines = stackString.split("\n");

  return lines.reduce((stack, line) => {
    const parseResult = parseChrome(line) || parseWinjs(line) || parseGecko(line) || parseNode(line) || parseJSC(line);

    if (parseResult) {
      stack.push(parseResult);
    }

    return stack;
  }, []);
}

const formatFile = file => {
  if (!file) {
    return "";
  }

  if (file.startsWith("blob:")) {
    if (globalThis["__BUN"]?.client) {
      const replacement = globalThis["__BUN"]?.client.dependencies.getFilePathFromBlob(file);
      if (replacement) {
        file = replacement;
      }
    }
  }

  var _file = String(file);
  if (_file.startsWith(globalThis.location?.origin)) {
    _file = _file.substring(globalThis.location?.origin.length);
  }

  while (_file.startsWith("/")) {
    _file = _file.substring(1);
  }

  if (_file.endsWith(".bun")) {
    _file = "node_modules.bun";
  }

  return _file;
};

const chromeRe =
  /^\s*at (.*?) ?\(((?:file|https?|blob|chrome-extension|native|eval|webpack|<anonymous>|\/|[a-z]:\\|\\\\).*?)(?::(\d+))?(?::(\d+))?\)?\s*$/i;
const chromeEvalRe = /\((\S*)(?::(\d+))(?::(\d+))\)/;

function parseChrome(line) {
  const parts = chromeRe.exec(line);

  if (!parts) {
    return null;
  }

  const isNative = parts[2] && parts[2].indexOf("native") === 0; // start of line
  const isEval = parts[2] && parts[2].indexOf("eval") === 0; // start of line

  const submatch = chromeEvalRe.exec(parts[2]);
  if (isEval && submatch != null) {
    // throw out eval line/column and use top-most line/column number
    parts[2] = submatch[1]; // url
    parts[3] = submatch[2]; // line
    parts[4] = submatch[3]; // column
  }

  return {
    file: formatFile(!isNative ? parts[2] : null),
    function_name: parts[1] || "",
    position: {
      line: parts[3] ? +parts[3] : null,
      column_start: parts[4] ? +parts[4] : null,
    },
  };
}

const winjsRe =
  /^\s*at (?:((?:\[object object\])?.+) )?\(?((?:file|ms-appx|https?|webpack|blob):.*?):(\d+)(?::(\d+))?\)?\s*$/i;

function parseWinjs(line) {
  const parts = winjsRe.exec(line);

  if (!parts) {
    return null;
  }

  return {
    file: formatFile(parts[2]),
    function_name: parts[1],
    position: {
      line: +parts[3],
      column_start: parts[4] ? +parts[4] : null,
    },
  };
}

const geckoRe =
  /^\s*(.*?)(?:\((.*?)\))?(?:^|@)((?:file|https?|blob|chrome|webpack|resource|\[native).*?|[^@]*bundle)(?::(\d+))?(?::(\d+))?\s*$/i;
const geckoEvalRe = /(\S+) line (\d+)(?: > eval line \d+)* > eval/i;

function parseGecko(line) {
  const parts = geckoRe.exec(line);

  if (!parts) {
    return null;
  }

  const isEval = parts[3] && parts[3].indexOf(" > eval") > -1;

  const submatch = geckoEvalRe.exec(parts[3]);
  if (isEval && submatch != null) {
    // throw out eval line/column and use top-most line number
    parts[3] = submatch[1];
    parts[4] = submatch[2];
    parts[5] = null; // no column when eval
  }

  return {
    file: formatFile(parts[3]),
    function_name: parts[1] || "",
    position: {
      line: parts[4] ? +parts[4] : null,
      column_start: parts[5] ? +parts[5] : null,
    },
  };
}

const javaScriptCoreRe = /^\s*(?:([^@]*)(?:\((.*?)\))?@)?(\S.*?):(\d+)(?::(\d+))?\s*$/i;

function parseJSC(line) {
  const parts = javaScriptCoreRe.exec(line);

  if (!parts) {
    return null;
  }

  return {
    file: formatFile(parts[3]),
    function_name: parts[1] || "",
    position: {
      line: +parts[4],
      column_start: parts[5] ? +parts[5] : null,
    },
  };
}

const nodeRe = /^\s*at (?:((?:\[object object\])?[^\\/]+(?: \[as \S+\])?) )?\(?(.*?):(\d+)(?::(\d+))?\)?\s*$/i;

function parseNode(line) {
  const parts = nodeRe.exec(line);

  if (!parts) {
    return null;
  }

  return {
    file: formatFile(parts[2]),
    function_name: parts[1] || "",
    position: {
      line: +parts[3],
      column_start: parts[4] ? +parts[4] : null,
    },
  };
}
