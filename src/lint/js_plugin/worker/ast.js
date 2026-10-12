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

function defineDeprecated(prototype, name) {
  for (const [key, get] of Object.entries(deprecated[name] ?? {})) {
    Object.defineProperty(prototype, key, {
      get() {
        return get(this, this);
      },
      set(value) {
        Object.defineProperty(this, key, { value, writable: true, enumerable: true, configurable: true });
      },
      configurable: true,
    });
  }
}

function defineNodes() {
  native.defineNodes(Node.prototype);
  for (const name of Object.keys(deprecated)) defineDeprecated(native.nodePrototype(name), name);
}
