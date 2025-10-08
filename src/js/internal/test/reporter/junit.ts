const { inspectWithNoCustomRetry } = require("internal/test/reporter/utils");
const { hostname } = require("node:os");

const ArrayPrototypeFilter = Array.prototype.filter;
const ArrayPrototypeJoin = Array.prototype.join;
const ArrayPrototypeMap = Array.prototype.map;
const ArrayPrototypePush = Array.prototype.push;
const ArrayPrototypeSome = Array.prototype.some;
const NumberPrototypeToFixed = Number.prototype.toFixed;
const ObjectEntries = Object.entries;
const RegExpPrototypeSymbolReplace = RegExp.prototype[Symbol.replace];
const StringPrototypeRepeat = String.prototype.repeat;

const inspectOptions = { __proto__: null, colors: false, breakLength: Infinity };
const HOSTNAME = hostname();

function escapeAttribute(s = "") {
  return escapeContent(
    RegExpPrototypeSymbolReplace.$apply(/"/g, RegExpPrototypeSymbolReplace.$apply(/\n/g, s, ""), "&quot;"),
  );
}

function escapeContent(s = "") {
  return RegExpPrototypeSymbolReplace.$apply(/</g, RegExpPrototypeSymbolReplace.$apply(/&/g, s, "&amp;"), "&lt;");
}

function escapeComment(s = "") {
  return RegExpPrototypeSymbolReplace.$apply(/--/g, s, "&#45;&#45;");
}

function treeToXML(tree) {
  if (typeof tree === "string") {
    return `${escapeContent(tree)}\n`;
  }
  const { tag, attrs, nesting, children, comment } = tree;
  const indent = StringPrototypeRepeat.$apply("\t", nesting + 1);
  if (comment) {
    return `${indent}<!-- ${escapeComment(comment)} -->\n`;
  }
  const attrsString = ArrayPrototypeJoin.$apply(
    ArrayPrototypeMap.$apply(
      ObjectEntries(attrs),
      ({ 0: key, 1: value }) => `${key}="${escapeAttribute(String(value))}"`,
    ),
    " ",
  );
  if (!children?.length) {
    return `${indent}<${tag} ${attrsString}/>\n`;
  }
  const childrenString = ArrayPrototypeJoin.$apply(ArrayPrototypeMap.$apply(children ?? [], treeToXML), "");
  return `${indent}<${tag} ${attrsString}>\n${childrenString}${indent}</${tag}>\n`;
}

function isFailure(node) {
  return (
    (node?.children && ArrayPrototypeSome.$apply(node.children, c => c.tag === "failure")) || node?.attrs?.failures
  );
}

function isSkipped(node) {
  return (
    (node?.children && ArrayPrototypeSome.$apply(node.children, c => c.tag === "skipped")) || node?.attrs?.failures
  );
}

async function* junitReporter(source) {
  yield '<?xml version="1.0" encoding="utf-8"?>\n';
  yield "<testsuites>\n";
  let currentSuite = null;
  const roots = [];

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
      ArrayPrototypePush.$apply(originalSuite.children, currentSuite);
    }
    if (!currentSuite.parent) {
      ArrayPrototypePush.$apply(roots, currentSuite);
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
        currentTest.attrs.time = NumberPrototypeToFixed.$apply(event.data.details.duration_ms / 1000, 6);
        const nonCommentChildren = ArrayPrototypeFilter.$apply(currentTest.children, c => c.comment == null);
        if (nonCommentChildren.length > 0) {
          currentTest.tag = "testsuite";
          currentTest.attrs.disabled = 0;
          currentTest.attrs.errors = 0;
          currentTest.attrs.tests = nonCommentChildren.length;
          currentTest.attrs.failures = ArrayPrototypeFilter.$apply(currentTest.children, isFailure).length;
          currentTest.attrs.skipped = ArrayPrototypeFilter.$apply(currentTest.children, isSkipped).length;
          currentTest.attrs.hostname = HOSTNAME;
        } else {
          currentTest.tag = "testcase";
          currentTest.attrs.classname = event.data.classname ?? "test";
          if (event.data.skip) {
            ArrayPrototypePush.$apply(currentTest.children, {
              __proto__: null,
              nesting: event.data.nesting + 1,
              tag: "skipped",
              attrs: { __proto__: null, type: "skipped", message: event.data.skip },
            });
          }
          if (event.data.todo) {
            ArrayPrototypePush.$apply(currentTest.children, {
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
              attrs: { __proto__: null, type: error?.failureType || error?.code, message: error?.message ?? "" },
              children: [inspectWithNoCustomRetry(error, inspectOptions)],
            });
            currentTest.failures = 1;
            currentTest.attrs.failure = error?.message ?? "";
          }
        }
        break;
      }
      case "test:diagnostic": {
        const parent = currentSuite?.children ?? roots;
        ArrayPrototypePush.$apply(parent, {
          __proto__: null,
          nesting: event.data.nesting,
          comment: event.data.message,
        });
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

export default junitReporter;
