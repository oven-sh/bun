const colors = require("internal/util/colors");
const { SafeMap, hardenRegExp } = require("internal/primordials");

const ArrayPrototypeJoin = Array.prototype.join;
const RegExpPrototypeSymbolSplit = RegExp.prototype[Symbol.split];
const StringPrototypeRepeat = String.prototype.repeat;

const indentMemo = new SafeMap();

const inspectOptions = {
  __proto__: null,
  colors: colors.shouldColorize(process.stdout),
  breakLength: Infinity,
};

const reporterUnicodeSymbolMap = {
  "__proto__": null,
  "test:fail": "\u2716 ",
  "test:pass": "\u2714 ",
  "test:diagnostic": "\u2139 ",
  "test:coverage": "\u2139 ",
  "arrow:right": "\u25B6 ",
  "hyphen:minus": "\uFE63 ",
};

const reporterColorMap = {
  "__proto__": null,
  get "test:fail"() {
    return colors.red;
  },
  get "test:pass"() {
    return colors.green;
  },
  get "test:diagnostic"() {
    return colors.blue;
  },
  get "info"() {
    return colors.blue;
  },
  get "warn"() {
    return colors.yellow;
  },
  get "error"() {
    return colors.red;
  },
};

function indent(nesting) {
  let value = indentMemo.get(nesting);
  if (value === undefined) {
    value = StringPrototypeRepeat.$apply("  ", nesting);
    indentMemo.set(nesting, value);
  }
  return value;
}

function formatError(error, indent) {
  if (!error) return "";
  const err = error.code === "ERR_TEST_FAILURE" ? error.cause : error;
  const message = ArrayPrototypeJoin.$apply(
    RegExpPrototypeSymbolSplit.$apply(hardenRegExp(/\r?\n/), inspectWithNoCustomRetry(err, inspectOptions)),
    `\n${indent}  `,
  );
  return `\n${indent}  ${message}\n`;
}

function formatTestReport(type, data, prefix = "", indent = "", hasChildren = false, showErrorDetails = true) {
  let color = reporterColorMap[type] ?? colors.white;
  let symbol = reporterUnicodeSymbolMap[type] ?? " ";
  const { skip, todo } = data;
  const duration_ms = data.details?.duration_ms ? ` ${colors.gray}(${data.details.duration_ms}ms)${colors.white}` : "";
  let title = `${data.name}${duration_ms}`;

  if (skip !== undefined) {
    title += ` # ${typeof skip === "string" && skip.length ? skip : "SKIP"}`;
  } else if (todo !== undefined) {
    title += ` # ${typeof todo === "string" && todo.length ? todo : "TODO"}`;
  }

  const error = showErrorDetails ? formatError(data.details?.error, indent) : "";
  const err = hasChildren
    ? !error || data.details?.error?.failureType === "subtestsFailed"
      ? ""
      : `\n${error}`
    : error;

  if (skip !== undefined) {
    color = colors.gray;
    symbol = reporterUnicodeSymbolMap["hyphen:minus"];
  }
  return `${prefix}${indent}${color}${symbol}${title}${colors.white}${err}`;
}

let utilInspect;
function inspectWithNoCustomRetry(obj, options) {
  utilInspect ??= require("internal/util/inspect");
  const { inspect } = utilInspect;

  try {
    return inspect(obj, options);
  } catch {
    return inspect(obj, { ...options, customInspect: false });
  }
}

export default {
  reporterUnicodeSymbolMap,
  reporterColorMap,
  formatTestReport,
  indent,
  inspectWithNoCustomRetry,
};
