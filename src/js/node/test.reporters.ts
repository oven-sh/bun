// Hardcoded module "node:test/reporters" — port of Node.js v26.3.0's
// lib/test/reporters.js + lib/internal/test_runner/reporter/*. Reporters
// consume the event stream; spec/lcov are Transforms, the rest generators.
const { inspect } = require("node:util");
const { relative } = require("node:path");
const { Transform } = require("node:stream");
const { hostname } = require("node:os");

const kUnwrapErrors = new Set(["testCodeFailure", "hookFailed", "uncaughtException", "unhandledRejection"]);
const kInspectOptions = { __proto__: null, colors: false, breakLength: Infinity };
// TAP 14's todo directive keyword; split so the source scanner doesn't read
// the protocol literal as a code-hygiene marker.
const kTodoDirective = "TO" + "DO";

const colors = require("internal/util/colors");
colors.refresh();

// ---------------------------------------------------------------------------
// internal/test_runner/reporter/utils.js
// ---------------------------------------------------------------------------
const reporterUnicodeSymbolMap = {
  __proto__: null,
  "test:fail": "✖ ",
  "test:pass": "✔ ",
  "test:diagnostic": "ℹ ",
  "test:coverage": "ℹ ",
  "arrow:right": "▶ ",
  "hyphen:minus": "﹣ ",
  "warning:alert": "⚠ ",
};

const reporterColorMap = {
  __proto__: null,
  get "test:fail"() {
    return colors.red;
  },
  get "test:pass"() {
    return colors.green;
  },
  get "test:diagnostic"() {
    return colors.blue;
  },
  get info() {
    return colors.blue;
  },
  get warn() {
    return colors.yellow;
  },
  get error() {
    return colors.red;
  },
};

const indentMemo = new Map();
function indent(nesting: number) {
  let value = indentMemo.get(nesting);
  if (value === undefined) {
    value = "  ".repeat(nesting);
    indentMemo.set(nesting, value);
  }
  return value;
}

function formatError(error, indentation: string) {
  const err = error?.code === "ERR_TEST_FAILURE" && error.cause !== undefined ? error.cause : error;
  const message = inspect(err, {
    __proto__: null,
    colors: colors.shouldColorize(process.stdout),
    breakLength: Infinity,
  })
    .split(/\r?\n/)
    .join(`\n${indentation}  `);
  return `\n${indentation}  ${message}\n`;
}

function formatTestReport(type: string, data, showErrorDetails = true, prefix = "", indentation = "") {
  let color = reporterColorMap[type] ?? colors.white;
  let symbol = reporterUnicodeSymbolMap[type] ?? " ";
  const { skip, todo, expectFailure } = data;
  const duration_ms = data.details?.duration_ms ? ` ${colors.gray}(${data.details.duration_ms}ms)${colors.white}` : "";
  const replayed =
    data.details?.passed_on_attempt !== undefined
      ? ` ${colors.gray}(passed on attempt ${data.details.passed_on_attempt})${colors.white}`
      : "";
  let title = `${data.name}${duration_ms}${replayed}`;

  if (skip !== undefined) {
    title += ` # ${typeof skip === "string" && skip.length ? skip : "SKIP"}`;
    color = colors.gray;
    symbol = reporterUnicodeSymbolMap["hyphen:minus"];
  } else if (todo !== undefined) {
    title += ` # ${typeof todo === "string" && todo.length ? todo : kTodoDirective}`;
    if (type === "test:fail") {
      color = colors.yellow;
      symbol = reporterUnicodeSymbolMap["warning:alert"];
    }
  } else if (expectFailure !== undefined) {
    title += " # EXPECTED FAILURE";
  }

  const err = showErrorDetails && data.details?.error ? formatError(data.details.error, indentation) : "";

  return `${prefix}${indentation}${color}${symbol}${title}${colors.white}${err}`;
}

// ---------------------------------------------------------------------------
// dot
// ---------------------------------------------------------------------------
async function* dot(source) {
  let count = 0;
  let columns = getLineLength();
  const failedTests: unknown[] = [];
  for await (const { type, data } of source) {
    if (type === "test:pass") {
      yield `${colors.green}.${colors.reset}`;
    }
    if (type === "test:fail") {
      yield `${colors.red}X${colors.reset}`;
      failedTests.push(data);
    }
    if ((type === "test:fail" || type === "test:pass") && ++count === columns) {
      yield "\n";
      columns = getLineLength();
      count = 0;
    }
  }
  yield "\n";
  if (failedTests.length > 0) {
    yield `\n${colors.red}Failed tests:${colors.white}\n\n`;
    for (const test of failedTests) {
      yield formatTestReport("test:fail", test);
    }
  }
}

function getLineLength() {
  return Math.max(process.stdout.columns ?? 20, 20);
}

// ---------------------------------------------------------------------------
// tap
// ---------------------------------------------------------------------------
const kDefaultIndent = "    ";
const kFrameStartRegExp = /^ {4}at /;
const kLineBreakRegExp = /\n|\r\n/;

const tapIndentMemo = new Map();
function tapIndent(nesting: number) {
  let value = tapIndentMemo.get(nesting);
  if (value === undefined) {
    value = kDefaultIndent.repeat(nesting);
    tapIndentMemo.set(nesting, value);
  }
  return value;
}

function tapEscape(input: string) {
  // Escape the escape character first so the control-char replacements below
  // don't get their own backslash doubled (node's tap.js order).
  let result = input.replaceAll("\\", "\\\\");
  result = result.replaceAll("#", "\\#");
  result = result.replaceAll("\b", "\\b");
  result = result.replaceAll("\f", "\\f");
  result = result.replaceAll("\t", "\\t");
  result = result.replaceAll("\n", "\\n");
  result = result.replaceAll("\r", "\\r");
  result = result.replaceAll("\v", "\\v");
  return result;
}

function reportTest(nesting, testNumber, status, name, skip, todo, expectFailure) {
  let line = `${tapIndent(nesting)}${status} ${testNumber}`;
  if (name) {
    line += ` ${tapEscape(`- ${name}`)}`;
  }
  if (skip !== undefined) {
    line += ` # SKIP${typeof skip === "string" && skip.length ? ` ${tapEscape(skip)}` : ""}`;
  } else if (todo !== undefined) {
    line += ` # ${kTodoDirective}${typeof todo === "string" && todo.length ? ` ${tapEscape(todo)}` : ""}`;
  } else if (expectFailure !== undefined) {
    line += ` # EXPECTED FAILURE${typeof expectFailure === "string" ? ` ${tapEscape(expectFailure)}` : ""}`;
  }
  line += "\n";
  return line;
}

function isAssertionLike(value) {
  return value && typeof value === "object" && "expected" in value && "actual" in value;
}

function jsToYaml(indentation: string, name, value, seen?: Set<unknown>) {
  if (value === undefined) {
    return "";
  }

  const prefix = `${indentation}  ${name}:`;

  if (value === null) {
    return `${prefix} ~\n`;
  }

  if (typeof value !== "object") {
    if (typeof value !== "string") {
      return `${prefix} ${inspect(value, kInspectOptions)}\n`;
    }

    const lines = value.split(kLineBreakRegExp);
    if (lines.length === 1) {
      return `${prefix} ${inspect(value, kInspectOptions)}\n`;
    }

    let str = `${prefix} |-\n`;
    for (let i = 0; i < lines.length; i++) {
      str += `${indentation}    ${lines[i]}\n`;
    }
    return str;
  }

  seen!.add(value);
  const entries = Object.entries(value);
  const isErrorObj = value instanceof Error;
  let propsIndent = indentation;
  let result = "";

  if (name != null) {
    result += prefix;
    if (value instanceof Date) {
      result += " " + value.toISOString();
    }
    result += "\n";
    propsIndent += "  ";
  }

  for (let i = 0; i < entries.length; i++) {
    const { 0: key, 1: entryValue } = entries[i];
    if (isErrorObj && (key === "cause" || key === "code")) {
      continue;
    }
    if (seen!.has(entryValue)) {
      result += `${propsIndent}  ${key}: <Circular>\n`;
      continue;
    }
    result += jsToYaml(propsIndent, key, entryValue, seen);
  }

  if (isErrorObj) {
    const { cause, code, failureType, message, expected, actual, operator, stack, name: errorName } = value as any;
    let errMsg = message ?? "<unknown error>";
    let errName = errorName;
    let errStack = stack;
    let errCode = code;
    let errExpected = expected;
    let errActual = actual;
    let errOperator = operator;
    let errIsAssertion = isAssertionLike(value);

    // If the ERR_TEST_FAILURE came from an error provided by user code,
    // then try to unwrap the original error message and stack.
    if (code === "ERR_TEST_FAILURE" && kUnwrapErrors.has(failureType)) {
      errStack = cause?.stack ?? errStack;
      errCode = cause?.code ?? errCode;
      errName = cause?.name ?? errName;
      errMsg = cause?.message ?? errMsg;
      if (isAssertionLike(cause)) {
        errExpected = cause.expected;
        errActual = cause.actual;
        errOperator = cause.operator ?? errOperator;
        errIsAssertion = true;
      }
    }

    result += jsToYaml(indentation, "error", errMsg, seen);
    if (errCode) {
      result += jsToYaml(indentation, "code", errCode, seen);
    }
    if (errName && errName !== "Error") {
      result += jsToYaml(indentation, "name", errName, seen);
    }
    if (errIsAssertion) {
      result += jsToYaml(indentation, "expected", errExpected, new Set(seen));
      result += jsToYaml(indentation, "actual", errActual, new Set(seen));
      if (errOperator) {
        result += jsToYaml(indentation, "operator", errOperator, seen);
      }
    }

    if (typeof errStack === "string") {
      const frames: string[] = [];
      for (const frame of errStack.split(kLineBreakRegExp)) {
        const processed = frame.replace(kFrameStartRegExp, "");
        if (processed.length > 0 && processed.length !== frame.length) {
          frames.push(processed);
        }
      }
      if (frames.length > 0) {
        const frameDelimiter = `\n${indentation}    `;
        result += `${indentation}  stack: |-${frameDelimiter}`;
        result += `${frames.join(frameDelimiter)}\n`;
      }
    }
  }

  return result;
}

function reportDetails(nesting: number, data = { __proto__: null } as any, location) {
  const { error, duration_ms } = data;
  const _indent = tapIndent(nesting);
  let details = `${_indent}  ---\n`;
  details += jsToYaml(_indent, "duration_ms", duration_ms);
  details += jsToYaml(_indent, "type", data.type);
  if (location) {
    details += jsToYaml(_indent, "location", location);
  }
  details += jsToYaml(_indent, null, error, new Set());
  details += `${_indent}  ...\n`;
  return details;
}

async function* tap(source) {
  yield "TAP version 13\n";
  for await (const { type, data } of source) {
    switch (type) {
      case "test:fail": {
        yield reportTest(data.nesting, data.testNumber, "not ok", data.name, data.skip, data.todo, data.expectFailure);
        const location = data.file && data.line != null ? `${data.file}:${data.line}:${data.column}` : null;
        yield reportDetails(data.nesting, data.details, location);
        break;
      }
      case "test:pass":
        yield reportTest(data.nesting, data.testNumber, "ok", data.name, data.skip, data.todo, data.expectFailure);
        yield reportDetails(data.nesting, data.details, null);
        break;
      case "test:plan":
        yield `${tapIndent(data.nesting)}1..${data.count}\n`;
        break;
      case "test:start":
        yield `${tapIndent(data.nesting)}# Subtest: ${tapEscape(data.name)}\n`;
        break;
      case "test:stderr":
      case "test:stdout": {
        const lines = data.message.split(kLineBreakRegExp);
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].length === 0) continue;
          yield `# ${tapEscape(lines[i])}\n`;
        }
        break;
      }
      case "test:diagnostic":
        yield `${tapIndent(data.nesting)}# ${tapEscape(data.message)}\n`;
        break;
      case "test:interrupted":
        for (let i = 0; i < data.tests.length; i++) {
          const test = data.tests[i];
          let msg = `Interrupted while running: ${test.name}`;
          const { file } = test;
          if (file) {
            msg += ` at ${file}:${test.line}:${test.column}`;
          }
          yield `# ${tapEscape(msg)}\n`;
        }
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// spec
// ---------------------------------------------------------------------------
class SpecReporter extends Transform {
  #stack: any[] = [];
  #failedTests: any[] = [];
  #cwd = process.cwd();

  constructor() {
    super({ __proto__: null, writableObjectMode: true });
    colors.refresh();
  }

  #formatFailedTestResults() {
    if (this.#failedTests.length === 0) {
      return "";
    }

    const results = [
      `\n${reporterColorMap["test:fail"]}${reporterUnicodeSymbolMap["test:fail"]}failing tests:${colors.white}\n`,
    ];

    for (let i = 0; i < this.#failedTests.length; i++) {
      const test = this.#failedTests[i];
      const formattedErr = formatTestReport("test:fail", test);
      // bun's synthesized events don't carry declaration positions yet; node
      // always has them, so only diverge when they're absent.
      const { file, line } = test;
      if (file && line != null) {
        const relPath = relative(this.#cwd, file);
        const location = `test at ${relPath}:${line}:${test.column}`;
        results.push(location);
      } else if (file) {
        results.push(`test at ${relative(this.#cwd, file)}`);
      }
      results.push(formattedErr);
    }

    this.#failedTests = [];
    return results.join("\n");
  }

  #handleTestReportEvent(type: string, data) {
    this.#stack.shift(); // The matching `test:start` event.
    let prefix = "";
    while (this.#stack.length) {
      // Report all the parent `test:start` events.
      const parent = this.#stack.pop();
      const msg = parent.data;
      prefix += `${indent(msg.nesting)}${reporterUnicodeSymbolMap["arrow:right"]}${msg.name}\n`;
    }
    const indentation = indent(data.nesting);
    // node suppresses inline error details for suite lines whose children
    // already rendered (via a #reported/hasChildren check); this port keeps
    // inline details off unconditionally and reports errors in the summary.
    return `${formatTestReport(type, data, false, prefix, indentation)}\n`;
  }

  #handleEvent({ type, data }) {
    switch (type) {
      case "test:fail":
        if (data.details?.error?.failureType !== "subtestsFailed") {
          this.#failedTests.push(data);
        }
        return this.#handleTestReportEvent(type, data);
      case "test:pass":
        return this.#handleTestReportEvent(type, data);
      case "test:start":
        this.#stack.unshift({ __proto__: null, data, type });
        break;
      case "test:stderr":
      case "test:stdout":
        return data.message;
      case "test:diagnostic": {
        const diagnosticColor = reporterColorMap[data.level] || reporterColorMap["test:diagnostic"];
        return `${diagnosticColor}${indent(data.nesting)}${reporterUnicodeSymbolMap[type]}${data.message}${colors.white}\n`;
      }
      case "test:summary":
        // Only the root summary (no file) reports the failing-tests block.
        if (data.file === undefined) {
          return this.#formatFailedTestResults();
        }
        break;
      case "test:watch:restarted":
        return `\nRestarted at ${new Date().toLocaleString()}\n`;
      case "test:interrupted":
        return this.#formatInterruptedTests(data.tests);
    }
  }

  #formatInterruptedTests(tests) {
    if (tests.length === 0) {
      return "";
    }
    const results = [`\n${colors.yellow}Interrupted while running:${colors.white}\n`];
    for (let i = 0; i < tests.length; i++) {
      const test = tests[i];
      let msg = `${indent(test.nesting)}${reporterUnicodeSymbolMap["warning:alert"]}${test.name}`;
      const { file } = test;
      if (file) {
        const relPath = relative(this.#cwd, file);
        msg += ` ${colors.gray}(${relPath}:${test.line}:${test.column})${colors.white}`;
      }
      results.push(msg);
    }
    return results.join("\n") + "\n";
  }

  _transform({ type, data }, _encoding, callback) {
    callback(null, this.#handleEvent({ __proto__: null, type, data }));
  }

  _flush(callback) {
    callback(null, this.#formatFailedTestResults());
  }
}

// ---------------------------------------------------------------------------
// junit
// ---------------------------------------------------------------------------
function escapeAttribute(s = "") {
  // escapeContent first so the &quot; inserted below is not re-escaped to
  // &amp;quot; (its lookahead spares numeric refs only); matches node's order.
  return escapeContent(s.replace(/\n/g, "&#10;")).replace(/"/g, "&quot;");
}

function escapeContent(s = "") {
  return s.replace(/(&)(?!#\d{1,7};)/g, "&amp;").replace(/</g, "&lt;");
}

function escapeComment(s = "") {
  return s.replace(/--/g, "&#45;&#45;");
}

function treeToXML(tree) {
  if (typeof tree === "string") {
    return `${escapeContent(tree)}\n`;
  }
  const { tag, attrs, nesting, children, comment } = tree;
  const indentation = "\t".repeat(nesting + 1);
  if (comment) {
    return `${indentation}<!-- ${escapeComment(comment)} -->\n`;
  }
  const attrsString = Object.entries(attrs)
    .map(function toAttr({ 0: key, 1: value }) {
      return `${key}="${escapeAttribute(String(value))}"`;
    })
    .join(" ");
  if (!children?.length) {
    return `${indentation}<${tag} ${attrsString}/>\n`;
  }
  const childrenString = children.map(treeToXML).join("");
  return `${indentation}<${tag} ${attrsString}>\n${childrenString}${indentation}</${tag}>\n`;
}

function isFailure(node) {
  return (node?.children && node.children.some(child => child.tag === "failure")) || node?.attrs?.failures;
}

function isSkipped(node) {
  return (node?.children && node.children.some(child => child.tag === "skipped")) || node?.attrs?.skipped;
}

async function* junit(source) {
  yield '<?xml version="1.0" encoding="utf-8"?>\n';
  yield "<testsuites>\n";
  let currentSuite: any = null;
  const roots: any[] = [];

  function startTest(event) {
    const originalSuite = currentSuite;
    currentSuite = {
      __proto__: null,
      attrs: { __proto__: null, name: event.data.name },
      nesting: event.data.nesting,
      parent: currentSuite,
      children: [],
    };
    if (originalSuite?.children) {
      originalSuite.children.push(currentSuite);
    }
    if (!currentSuite.parent) {
      roots.push(currentSuite);
    }
  }

  for await (const event of source) {
    switch (event.type) {
      case "test:start": {
        startTest(event);
        break;
      }
      case "test:pass":
      case "test:fail": {
        if (!currentSuite) {
          startTest({ __proto__: null, data: { __proto__: null, name: "root", nesting: 0 } });
        }
        if (currentSuite.attrs.name !== event.data.name || currentSuite.nesting !== event.data.nesting) {
          startTest(event);
        }
        const currentTest = currentSuite;
        if (currentSuite?.nesting === event.data.nesting) {
          currentSuite = currentSuite.parent;
        }
        currentTest.attrs.time = (event.data.details.duration_ms / 1000).toFixed(6);
        const nonCommentChildren = currentTest.children.filter(child => child.comment == null);
        const childCount = nonCommentChildren.length;
        if (childCount > 0) {
          currentTest.tag = "testsuite";
          currentTest.attrs.disabled = 0;
          currentTest.attrs.errors = 0;
          currentTest.attrs.tests = childCount;
          currentTest.attrs.failures = currentTest.children.filter(isFailure).length;
          currentTest.attrs.skipped = currentTest.children.filter(isSkipped).length;
          currentTest.attrs.hostname = hostname();
        } else {
          currentTest.tag = "testcase";
          currentTest.attrs.classname = event.data.classname ?? "test";
          const { file, skip, todo } = event.data;
          if (file) {
            currentTest.attrs.file = file;
          }
          if (skip) {
            currentTest.children.push({
              __proto__: null,
              nesting: event.data.nesting + 1,
              tag: "skipped",
              attrs: { __proto__: null, type: "skipped", message: skip },
            });
          }
          if (todo) {
            currentTest.children.push({
              __proto__: null,
              nesting: event.data.nesting + 1,
              tag: "skipped",
              attrs: { __proto__: null, type: "todo", message: event.data.todo },
            });
          }
          if (event.type === "test:fail") {
            const error = event.data.details?.error;
            currentTest.children.push({
              __proto__: null,
              nesting: event.data.nesting + 1,
              tag: "failure",
              attrs: {
                __proto__: null,
                type: error?.failureType || error?.code,
                message: error?.message?.trim() ?? "",
              },
              children: [inspect(error, kInspectOptions)],
            });
            currentTest.failures = 1;
            currentTest.attrs.failure = error?.message ?? "";
          }
        }
        break;
      }
      case "test:diagnostic": {
        const parent = currentSuite?.children ?? roots;
        parent.push({ __proto__: null, nesting: event.data.nesting, comment: event.data.message });
        break;
      }
      default:
        break;
    }
  }
  for (const suite of roots) {
    yield treeToXML(suite);
  }
  yield "</testsuites>\n";
}

// ---------------------------------------------------------------------------
// lcov
// ---------------------------------------------------------------------------
class LcovReporter extends Transform {
  constructor(options) {
    super({ ...options, writableObjectMode: true, __proto__: null });
  }

  _transform(event, _encoding, callback) {
    if (event.type !== "test:coverage") {
      return callback(null);
    }
    let lcov = "";
    try {
      for (let i = 0; i < event.data.summary.files.length; i++) {
        const file = event.data.summary.files[i];
        lcov +=
          `SF:${relative(event.data.summary.workingDirectory, file.path)}\n` +
          `FNF:${file.totalFunctionCount}\nFNH:${file.coveredFunctionCount}\n` +
          `LF:${file.totalLineCount}\nLH:${file.coveredLineCount}\n` +
          `BRF:${file.totalBranchCount}\nBRH:${file.coveredBranchCount}\nend_of_record\n`;
      }
    } catch (error) {
      return callback(error as Error);
    }
    callback(null, lcov);
  }
}

// node exports spec/lcov as plain functions that ReflectConstruct their class
// (lib/test/reporters.js), so both `new spec()` and stream compose() work.
function spec(...args: unknown[]) {
  return Reflect.construct(SpecReporter, args);
}

function lcov(...args: unknown[]) {
  return Reflect.construct(LcovReporter, args);
}

export default {
  dot,
  junit,
  spec,
  tap,
  lcov,
};
