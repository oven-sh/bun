// ------------- the syntax tree -------------
//
// `native.listen` makes the nodes of a file from the arrays that `ast.rs` describes: src/jsc/bindings/LintNodes.cpp. A node is an object
// with the fields of its type as its own properties, as a parser makes it: rules go through `Object.keys(node)`. Only `loc` is
// computed when it is asked for. What is here is what the nodes inherit.

// The nodes of the file, by their number. Empty: nobody has asked for them yet.
let nodes = [];

// `loc` becomes an own property the first time it is asked for: src/jsc/bindings/LintSourceCode.cpp.
class Node {}
Object.defineProperty(Node.prototype, "loc", { get: native.locGetter, set: native.locSetter, configurable: true });

// By node: the node that typescript-estree makes for a deprecated property of it.
const madeFor = new WeakMap();

// It has no `parent`: nothing goes through it.
function makeFor(node, type, range, fields) {
  if (!madeFor.has(node)) madeFor.set(node, Object.assign(Object.create(Node.prototype), { type, ...fields, range }));
  return madeFor.get(node);
}

// The deprecated properties of typescript-estree: other properties by an older name, or in a node of their own. They are not
// enumerable. The rules of typescript-eslint until version 7 read them.
const deprecated = {
  ImportDeclaration: { assertions: node => node.attributes },
  ExportNamedDeclaration: { assertions: node => node.attributes },
  ExportAllDeclaration: { assertions: node => node.attributes },
  ImportExpression: { attributes: node => node.options },
  TSEnumDeclaration: { members: node => node.body.members },
  TSEnumMember: { computed: node => node.id.type !== "Identifier" && node.id.type !== "Literal" },
  TSImportType: { argument: node => makeFor(node, "TSLiteralType", [...node.source.range], { literal: node.source }) },
  TSMappedType: {
    typeParameter: ({ key, constraint }, node) =>
      makeFor(node, "TSTypeParameter", [key.range[0], constraint.range[1]], {
        const: false,
        constraint,
        default: undefined,
        in: false,
        name: key,
        out: false,
      }),
  },
};

// A getter and a setter for the deprecated property `key`.
function deprecatedAccessors(key, get) {
  return [
    function () {
      return get(this, this);
    },
    function (value) {
      Object.defineProperty(this, key, { value, writable: true, enumerable: true, configurable: true });
    },
  ];
}

// The nodes are laid out as the parser of the real tool lays them out: see `layouts.rs`.
const hasExactNodes = process.env.BUN_LINT_EXACT_NODES === "1";

function defineNodes() {
  const accessors = {};
  for (const [name, properties] of Object.entries(deprecated)) {
    for (const [key, get] of Object.entries(properties)) accessors[`${name}.${key}`] = deprecatedAccessors(key, get);
  }
  const flags = (hasExactNodes ? 1 : 0) | (process.env.BUN_LINT_EAGER_LOC === "1" ? 2 : 0);
  native.defineNodes(Node.prototype, flags, accessors);
  if (hasExactNodes) return;
  for (const [name, properties] of Object.entries(deprecated)) {
    for (const key of Object.keys(properties)) {
      const [get, set] = accessors[`${name}.${key}`];
      Object.defineProperty(native.nodePrototype(name), key, { get, set, configurable: true });
    }
  }
}
