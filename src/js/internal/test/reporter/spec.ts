const Transform = require("internal/streams/transform");
const colors = require("internal/util/colors");
const { relative } = require("node:path");
const {
  formatTestReport,
  indent,
  reporterColorMap,
  reporterUnicodeSymbolMap,
} = require("internal/test/reporter/utils");

const ArrayPrototypeJoin = Array.prototype.join;
const ArrayPrototypePop = Array.prototype.pop;
const ArrayPrototypePush = Array.prototype.push;
const ArrayPrototypeShift = Array.prototype.shift;
const ArrayPrototypeUnshift = Array.prototype.unshift;

class SpecReporter extends Transform {
  #stack = [];
  #reported = [];
  #failedTests = [];
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

      if (test.file) {
        const relPath = relative(this.#cwd, test.file);
        const location = `test at ${relPath}:${test.line}:${test.column}`;
        ArrayPrototypePush.$apply(results, location);
      }

      ArrayPrototypePush.$apply(results, formattedErr);
    }

    this.#failedTests = []; // Clean up the failed tests
    return ArrayPrototypeJoin.$apply(results, "\n");
  }
  #handleTestReportEvent(type, data) {
    const subtest = ArrayPrototypeShift.$apply(this.#stack); // This is the matching `test:start` event
    if (subtest) {
      $assert(subtest.type === "test:start");
      $assert(subtest.data.nesting === data.nesting);
      $assert(subtest.data.name === data.name);
    }
    let prefix = "";
    while (this.#stack.length) {
      // Report all the parent `test:start` events
      const parent = ArrayPrototypePop.$apply(this.#stack);
      $assert(parent.type === "test:start");
      const msg = parent.data;
      ArrayPrototypeUnshift.$apply(this.#reported, msg);
      prefix += `${indent(msg.nesting)}${reporterUnicodeSymbolMap["arrow:right"]}${msg.name}\n`;
    }
    let hasChildren = false;
    if (this.#reported[0] && this.#reported[0].nesting === data.nesting && this.#reported[0].name === data.name) {
      ArrayPrototypeShift.$apply(this.#reported);
      hasChildren = true;
    }
    const indentation = indent(data.nesting);
    return `${formatTestReport(type, data, prefix, indentation, hasChildren, false)}\n`;
  }
  #handleEvent({ type, data }) {
    switch (type) {
      case "test:fail":
        if (data.details?.error?.failureType !== kSubtestsFailed) {
          ArrayPrototypePush.$apply(this.#failedTests, data);
        }
        return this.#handleTestReportEvent(type, data);
      case "test:pass":
        return this.#handleTestReportEvent(type, data);
      case "test:start":
        ArrayPrototypeUnshift.$apply(this.#stack, { __proto__: null, data, type });
        break;
      case "test:stderr":
      case "test:stdout":
        return data.message;
      case "test:diagnostic": {
        const diagnosticColor = reporterColorMap[data.level] || reporterColorMap["test:diagnostic"];
        return `${diagnosticColor}${indent(data.nesting)}${reporterUnicodeSymbolMap[type]}${data.message}${colors.white}\n`;
      }
      case "test:coverage":
        return getCoverageReport(
          indent(data.nesting),
          data.summary,
          reporterUnicodeSymbolMap["test:coverage"],
          colors.blue,
          true,
        );
      case "test:summary":
        // We report only the root test summary
        if (data.file === undefined) {
          return this.#formatFailedTestResults();
        }
    }
  }
  _transform({ type, data }, encoding, callback) {
    callback(null, this.#handleEvent({ __proto__: null, type, data }));
  }
  _flush(callback) {
    callback(null, this.#formatFailedTestResults());
  }
}

export default SpecReporter;
