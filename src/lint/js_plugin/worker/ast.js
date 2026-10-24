// ------------- the syntax tree -------------
//
// `native.listen` makes the nodes of a file from the arrays that `ast.rs` describes: src/jsc/bindings/LintNodes.cpp. They are laid out
// as the parser of the real tool lays them out: see `layouts.rs`. What is here is the deprecated properties of typescript-estree.

// The nodes of the file, by their number. Empty: nobody has asked for them yet.
let nodes = [];

// By node: the node that typescript-estree makes for a deprecated property of it.
const madeFor = new WeakMap();

// typescript-estree converts what is behind a deprecated property a second time. So these are other nodes, and they have no `parent`:
// no traversal reaches them. Until version 7 they're in the tree. The rules of that time look for the scope of such a node, so with
// an installed parser of that time each has its `parent`.
function convertedAgain(value, parent) {
  if (value === null || typeof value !== "object" || value instanceof RegExp) return value;
  if (Array.isArray(value)) return value.map(it => convertedAgain(it, parent));
  const copy = {};
  const isNode = parent !== undefined && typeof value.type === "string";
  for (const key of Reflect.ownKeys(value)) {
    if (key === "parent") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if ("value" in descriptor) descriptor.value = convertedAgain(descriptor.value, isNode ? copy : parent);
    Object.defineProperty(copy, key, descriptor);
  }
  if (isNode) copy.parent = parent;
  return copy;
}

const orUndefined = node => ((installedMajor("@typescript-eslint/parser") ?? 8) < 8 ? node : undefined);

// `fields` gets the `parent` for `convertedAgain`.
function makeFor(node, type, range, fields) {
  if (madeFor.has(node)) return madeFor.get(node);
  const at = index => {
    const { line, column } = sourceCode.getLocFromIndex(index);
    return { column, line };
  };
  const made = { type };
  Object.assign(made, fields(orUndefined(made)), { range, loc: { end: at(range[1]), start: at(range[0]) } });
  if (orUndefined(made)) made.parent = node;
  madeFor.set(node, made);
  return made;
}

// The deprecated properties of typescript-estree: other properties by an older name, or in a node of their own. They are not
// enumerable. The rules of typescript-eslint until version 7 read them.
const deprecated = {
  ImportDeclaration: { assertions: node => node.attributes },
  ExportNamedDeclaration: { assertions: node => node.attributes },
  ExportAllDeclaration: { assertions: node => node.attributes },
  ImportExpression: { attributes: node => node.options },
  TSEnumDeclaration: {
    members(node) {
      if (!madeFor.has(node)) madeFor.set(node, convertedAgain(node.body.members, orUndefined(node)));
      return madeFor.get(node);
    },
  },
  // A name in brackets is a parsing error.
  TSEnumMember: { computed: () => false },
  TSImportType: {
    argument: node => makeFor(node, "TSLiteralType", [...node.source.range], () => ({ literal: node.source })),
  },
  TSMappedType: {
    typeParameter: ({ key, constraint }, node) =>
      makeFor(node, "TSTypeParameter", [key.range[0], constraint.range[1]], parent => ({
        const: false,
        constraint: convertedAgain(constraint, parent),
        default: undefined,
        in: false,
        name: convertedAgain(key, parent),
        out: false,
      })),
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

function defineNodes() {
  const accessors = {};
  for (const [name, properties] of Object.entries(deprecated)) {
    for (const [key, get] of Object.entries(properties)) accessors[`${name}.${key}`] = deprecatedAccessors(key, get);
  }
  native.defineNodes(accessors);
}
