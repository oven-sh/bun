// Custom oxlint rules for Bun's built-in JavaScript (src/js/**) and its test
// suite (test/**).
//
// Registered via `jsPlugins` in oxlint.json; which rule applies to which tree
// is configured there. Rules are written against oxlint's ESTree-compatible
// AST (see the `oxlint/plugins-dev` type definitions). Run with `bun run lint`.

/**
 * Return a textual key for a simple static member expression chain made of
 * identifiers and `this`, e.g. `options.foo` or `this.a.b`. Returns `null`
 * for anything else (computed access, calls, optional chaining, literals).
 */
function memberExpressionKey(node) {
  if (!node || node.type !== "MemberExpression" || node.computed || node.optional) {
    return null;
  }
  const { object, property } = node;
  if (!property || property.type !== "Identifier") {
    return null;
  }
  let base;
  if (object.type === "Identifier") {
    base = object.name;
  } else if (object.type === "ThisExpression") {
    base = "this";
  } else if (object.type === "MemberExpression") {
    base = memberExpressionKey(object);
    if (base === null) return null;
  } else {
    return null;
  }
  return base + "." + property.name;
}

/**
 * True if `node` is the target of an assignment (simple or compound), an
 * update expression, or a `delete`. None of these can be replaced by a read
 * of a cached local.
 */
function isWriteTarget(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (parent.type === "AssignmentExpression" && parent.left === node) return true;
  if (parent.type === "UpdateExpression" && parent.argument === node) return true;
  if (parent.type === "UnaryExpression" && parent.operator === "delete" && parent.argument === node) return true;
  return false;
}

/**
 * True if `node` is the callee of a call/new/tagged-template. Caching a
 * method in a local loses the receiver, so `obj.fn()` in the body is not
 * something a simple `const fn = obj.fn` can replace.
 */
function isCallee(node) {
  const parent = node.parent;
  if (!parent) return false;
  if ((parent.type === "CallExpression" || parent.type === "NewExpression") && parent.callee === node) return true;
  if (parent.type === "TaggedTemplateExpression" && parent.tag === node) return true;
  return false;
}

function skipKey(k) {
  return k === "parent" || k === "type" || k === "loc" || k === "range" || k === "start" || k === "end";
}

/**
 * Collect every simple static member-expression read inside the `if` test.
 * Only the outermost chain is recorded (`a.b.c`, not also `a.b`). Callees and
 * write targets are ignored: `if (obj.fn())` reads `obj.fn` but the value
 * itself isn't something a local can reuse.
 *
 * A member expression that appears as the right-hand side of an assignment
 * (`(local = obj.prop)`) is recorded in `cached` instead of `out`: that is
 * the inline cache pattern this rule recommends, so a fallback
 * `local ?? obj.prop` read in the body should not be flagged.
 */
function collectTestMembers(node, out, cached) {
  if (!node || typeof node !== "object") return;
  switch (node.type) {
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
    case "ClassDeclaration":
    case "ClassExpression":
      return;
    case "MemberExpression":
      if (!isCallee(node) && !isWriteTarget(node)) {
        const key = memberExpressionKey(node);
        if (key !== null) {
          const parent = node.parent;
          if (parent && parent.type === "AssignmentExpression" && parent.operator === "=" && parent.right === node) {
            cached.add(key);
          } else if (!out.has(key)) {
            out.set(key, node);
          }
          return;
        }
      }
      break;
  }
  for (const k in node) {
    if (skipKey(k)) continue;
    const v = node[k];
    if (Array.isArray(v)) {
      for (const child of v) {
        if (child && typeof child === "object") collectTestMembers(child, out, cached);
      }
    } else if (v && typeof v === "object" && typeof v.type === "string") {
      collectTestMembers(v, out, cached);
    }
  }
}

const READ = 1;
const WRITE = 2;
const CALLED = 4;

/**
 * Walk `node` collecting read/write/called flags for the static member
 * expression identified by `key`. Does not descend into nested functions or
 * classes: those run later with a different scope, so caching at the `if`
 * wouldn't help (and the value may legitimately differ by then).
 */
function memberAccessFlags(node, key) {
  if (!node || typeof node !== "object") return 0;
  let flags = 0;
  switch (node.type) {
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
    case "ClassDeclaration":
    case "ClassExpression":
      return 0;
    case "MemberExpression":
      if (memberExpressionKey(node) === key) {
        if (isWriteTarget(node)) {
          // Compound assignments (`+=`, `&&=`) and `++`/`--` also read the
          // previous value, but the suggested refactor still can't
          // eliminate the write-back, so treat them purely as writes here.
          flags |= WRITE;
        } else if (isCallee(node)) {
          flags |= CALLED;
        } else {
          flags |= READ;
        }
      }
      break;
  }
  for (const k in node) {
    if (skipKey(k)) continue;
    const v = node[k];
    if (Array.isArray(v)) {
      for (const child of v) {
        if (child && typeof child === "object") flags |= memberAccessFlags(child, key);
      }
    } else if (v && typeof v === "object" && typeof v.type === "string") {
      flags |= memberAccessFlags(v, key);
    }
  }
  return flags;
}

const noDuplicateConditionalPropertyAccess = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow reading the same property in an `if` condition and again in its body. " +
        "Destructure or cache the property in a local first so the getter runs once.",
    },
    messages: {
      duplicate:
        "`{{expr}}` is read in the `if` condition and again in the body. " +
        "Read it into a local first (e.g. `const { {{prop}} } = {{base}}`) so the property is only accessed once.",
    },
    schema: [],
  },
  create(context) {
    return {
      IfStatement(node) {
        const members = new Map();
        const cached = new Set();
        collectTestMembers(node.test, members, cached);
        // A property already cached via `(local = obj.prop)` in the
        // condition is the pattern this rule recommends; don't flag it.
        for (const key of cached) members.delete(key);
        if (members.size === 0) return;

        for (const [key, member] of members) {
          const flags = memberAccessFlags(node.consequent, key);
          // If the body writes to the same property, caching it in a local
          // would change semantics (later reads would see the stale value).
          if (flags & WRITE) continue;
          // If the body calls it as a method, caching it in a local loses
          // the receiver; the simple refactor doesn't apply.
          if (flags & CALLED) continue;
          if (!(flags & READ)) continue;

          const dot = key.lastIndexOf(".");
          context.report({
            node: member,
            messageId: "duplicate",
            data: {
              expr: key,
              prop: key.slice(dot + 1),
              base: key.slice(0, dot),
            },
          });
        }
      },
    };
  },
};

// `bun test` rewrites imports of these to bun:test, and injects the bun:test
// globals into files that import none of them.
const TEST_MODULES = new Set(["bun:test", "@jest/globals", "vitest"]);

function isTestModuleSpecifier(node) {
  return node && node.type === "Literal" && TEST_MODULES.has(node.value);
}

/**
 * True for the initializer of `const { expect } = require("bun:test")` or
 * `const { expect } = Bun.jest(path)` (how the shared harness files obtain a
 * per-file `expect`).
 */
function isTestModuleValue(init) {
  if (!init || init.type !== "CallExpression") return false;
  const { callee } = init;
  if (callee.type === "Identifier") {
    return callee.name === "require" && isTestModuleSpecifier(init.arguments[0]);
  }
  return memberExpressionKey(callee) === "Bun.jest";
}

/**
 * True if the `expect` that `call` invokes is bun:test's: it either resolves
 * to nothing (the global `bun test` injects) or to a binding taken from a
 * test module. A local `function expect` / `const expect` (Node's own tests
 * use the name for expected values) is left alone.
 */
function isBunTestExpect(context, call) {
  let variable = null;
  for (let scope = context.sourceCode.getScope(call); scope; scope = scope.upper) {
    variable = scope.set.get("expect");
    if (variable) break;
  }
  if (!variable) return true;
  return variable.defs.some(def => {
    switch (def.type) {
      case "ImportBinding":
        return isTestModuleSpecifier(def.parent.source);
      case "Variable":
        return isTestModuleValue(def.node.init);
      default:
        return false;
    }
  });
}

// Properties of an expectation that return another expectation rather than
// asserting; `expect(x).not;` is "no matcher", not "matcher not called".
const EXPECT_MODIFIERS = new Set(["not", "resolves", "rejects"]);

/**
 * Walk up from an `expect(...)` call. Returns the outermost node of the
 * `expect(...).a.b` chain if the statement discards it without ever calling a
 * matcher, or `null` if a matcher is called (`expect(x).toBe(1)`) or the
 * value is consumed by something else (assigned, passed as an argument,
 * returned, used as a condition), which this rule does not second-guess.
 */
function discardedExpectChain(call) {
  let chainEnd = call;
  let cur = call;
  for (;;) {
    const parent = cur.parent;
    switch (parent.type) {
      case "MemberExpression":
        if (parent.object !== cur) return null;
        chainEnd = parent;
        break;
      case "ExpressionStatement":
        return chainEnd;
      case "SequenceExpression":
        // `(expect(a), b)` discards `expect(a)` whatever happens to the rest.
        if (parent.expressions[parent.expressions.length - 1] !== cur) return chainEnd;
        break;
      case "ConditionalExpression":
        if (parent.test === cur) return null;
        break;
      case "AwaitExpression":
      case "ChainExpression":
      case "ParenthesizedExpression":
      case "TSNonNullExpression":
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSTypeAssertion":
      case "LogicalExpression":
        break;
      default:
        // Includes CallExpression: either a matcher was called or the
        // expectation is an argument to something else.
        return null;
    }
    cur = parent;
  }
}

const noUnusedExpect = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow discarding an `expect(...)` without calling a matcher on it. " +
        "`expect(x);`, `expect(a, b);` and `expect(x).toBeTruthy;` build an expectation and assert nothing.",
    },
    messages: {
      noMatcher: "This `expect(...)` never calls a matcher, so it asserts nothing. Chain one, e.g. `.toBe(...)`.",
      secondArgument:
        "This `expect(a, b)` never calls a matcher, so it asserts nothing. " +
        "The second argument of `expect()` is a failure message, not an expected value; write `expect(a).toBe(b)`.",
      matcherNotCalled:
        "`.{{name}}` is read but not called, so this `expect(...)` asserts nothing. Did you mean `.{{name}}(...)`?",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "expect") return;
        const chainEnd = discardedExpectChain(node);
        if (chainEnd === null || !isBunTestExpect(context, node)) return;

        const property = chainEnd.type === "MemberExpression" && !chainEnd.computed ? chainEnd.property.name : null;
        if (property !== null && !EXPECT_MODIFIERS.has(property)) {
          context.report({ node: chainEnd, messageId: "matcherNotCalled", data: { name: property } });
        } else if (chainEnd === node && node.arguments.length >= 2) {
          context.report({ node, messageId: "secondArgument" });
        } else {
          context.report({ node: chainEnd, messageId: "noMatcher" });
        }
      },
    };
  },
};

export default {
  meta: {
    name: "bun",
  },
  rules: {
    "no-duplicate-conditional-property-access": noDuplicateConditionalPropertyAccess,
    "no-unused-expect": noUnusedExpect,
  },
};
