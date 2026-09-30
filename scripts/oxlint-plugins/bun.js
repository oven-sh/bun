// Custom oxlint rules for Bun's built-in JavaScript (src/js/**).
//
// Registered via `jsPlugins` in oxlint.json. Rules are written against
// oxlint's ESTree-compatible AST (see the `oxlint/plugins-dev` type
// definitions). Run with `bun run lint`.

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

export default {
  meta: {
    name: "bun",
  },
  rules: {
    "no-duplicate-conditional-property-access": noDuplicateConditionalPropertyAccess,
  },
};
