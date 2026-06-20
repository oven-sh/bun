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

function isNullOrUndefined(node) {
  if (!node) return false;
  if (node.type === "Literal" && node.value === null) return true;
  if (node.type === "Identifier" && node.name === "undefined") return true;
  if (node.type === "UnaryExpression" && node.operator === "void") return true;
  return false;
}

/**
 * If `node` is `<member> != null|undefined` (or `!==`, either order), return
 * the member expression; otherwise `null`. Only the not-equal forms are
 * considered: `if (x.y == null)` bodies run when the value is nullish, so
 * re-reading it there is not the pattern we're trying to prevent.
 */
function nullishComparisonMember(node) {
  if (!node || node.type !== "BinaryExpression") return null;
  const { operator, left, right } = node;
  if (operator !== "!=" && operator !== "!==") return null;
  if (isNullOrUndefined(right) && left.type === "MemberExpression") return left;
  if (isNullOrUndefined(left) && right.type === "MemberExpression") return right;
  return null;
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

const READ = 1;
const WRITE = 2;

/**
 * Walk `node` collecting read/write flags for the static member expression
 * identified by `key`. Does not descend into nested functions or classes:
 * those run later with a different scope, so caching at the `if` wouldn't
 * help (and the value may legitimately differ by then).
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
          flags |= WRITE;
          // Compound assignments (`+=`, `&&=`) and `++`/`--` also read the
          // previous value, but the suggested destructure still can't
          // eliminate the write-back, so treat them purely as writes here.
        } else {
          flags |= READ;
        }
      }
      break;
  }
  for (const k in node) {
    if (k === "parent" || k === "type" || k === "loc" || k === "range" || k === "start" || k === "end") continue;
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

const noDuplicateNullishPropertyAccess = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow re-reading the same property inside `if (obj.prop != null)`. " +
        "Destructure or cache the property in a local first so the getter runs once.",
    },
    messages: {
      duplicate:
        "`{{expr}}` is read again inside `if ({{expr}} {{op}} {{rhs}})`. " +
        "Read it into a local first (e.g. `const { {{prop}} } = {{base}}`) so the property is only accessed once.",
    },
    schema: [],
  },
  create(context) {
    return {
      IfStatement(node) {
        const member = nullishComparisonMember(node.test);
        if (!member) return;
        const key = memberExpressionKey(member);
        if (key === null) return;

        const flags = memberAccessFlags(node.consequent, key);
        // If the body writes to the same property, caching it in a local
        // would change semantics (later reads would see the stale value).
        if (flags & WRITE) return;
        if (!(flags & READ)) return;

        const dot = key.lastIndexOf(".");
        const { operator, left, right } = node.test;
        const rhsNode = isNullOrUndefined(right) ? right : left;
        context.report({
          node: node.test,
          messageId: "duplicate",
          data: {
            expr: key,
            op: operator,
            rhs: context.sourceCode.getText(rhsNode),
            prop: key.slice(dot + 1),
            base: key.slice(0, dot),
          },
        });
      },
    };
  },
};

export default {
  meta: {
    name: "bun",
  },
  rules: {
    "no-duplicate-nullish-property-access": noDuplicateNullishPropertyAccess,
  },
};
