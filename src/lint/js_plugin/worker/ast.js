// ───────────── the syntax tree ─────────────
//
// Makes the nodes of a file from the arrays that `ast.rs` describes. A node is an object with the
// fields of its type as its own properties, as a parser makes it: rules go through
// `Object.keys(node)`. Only `loc` is computed when it is asked for.

// The names of the types, by their number.
let typeNames = [];
// By the name of a type: its number.
const typeIds = new Map();
// ESLint's `visitorKeys`, for typescript-estree and for espree.
const visitorKeys = [{}, {}];
// For `native.nodes`, by dialect and type: what `native.shape` has made, and a bit for each field that a node does not have at all
// if there is nothing to say.
const shapes = [[], []];
const leftOutBits = [new Uint32Array(256), new Uint32Array(256)];
let knownStrings = [];

// The arrays of the file.
let tree = null;
// The nodes of the file, by their number.
let nodes = [];

// `loc` becomes an own property the first time it is asked for: src/jsc/bindings/LintSourceCode.cpp.
class Node {}
Object.defineProperty(Node.prototype, "loc", { get: native.locGetter, set: native.locSetter, configurable: true });

// The fields that a node does not have at all, where the others are `undefined`: rules ask whether a `Literal` has a `regex`.
// espree also leaves out the `directive` of a statement that is none.
const leftOut = new Set(["Literal.regex", "Literal.bigint", "JSXText.bigint", "TSModuleDeclaration.body"]);

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

// `types`: for each type `[name, [[field, flags], ..]]`. See `write_start` in `schema.rs`.
function defineTypes(types, strings) {
  knownStrings = strings;
  typeNames = types.map(type => type[0]);
  types.forEach(([name, fields], id) => {
    typeIds.set(name, id);
    for (const dialect of [0, 1]) {
      const own = fields.filter(([, flags]) => !(flags & (dialect === 0 ? 4 : 2)) && !(flags & 8));
      visitorKeys[dialect][name] = own.filter(([, flags]) => flags & 1).map(([field]) => field);
      const names = own.map(([field]) => field);
      const canBeLeftOut = field => leftOut.has(`${name}.${field}`) || (dialect === 1 && field === "directive");
      const some = names.filter(canBeLeftOut);
      // All nodes of a type have the same shape, but for these.
      const prototype = Object.create(Node.prototype);
      const shapeWith = which => {
        const has = field => !some.includes(field) || ((which >> some.indexOf(field)) & 1) === 1;
        return native.shape(prototype, ["type", ...names.filter(has), "start", "end", "range", "parent"], name);
      };
      shapes[dialect][id] =
        some.length === 0 ? shapeWith(0) : Array.from({ length: 1 << some.length }, (_, it) => shapeWith(it));
      for (const field of some) leftOutBits[dialect][id] |= 1 << names.indexOf(field);
      if (dialect === 1) continue;
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
  });
}

// The parts of the message that `ast.rs` writes that the traversal needs. `selectors`: how many were to be matched.
function readTree(buffer, selectors) {
  const header = new Uint32Array(buffer, 0, 10);
  const [count, fields, lists, strings, twice, matches, numbers, , dialect] = header;
  let at = 40;
  const words = length => {
    const part = new Uint32Array(buffer, at, length);
    at += 4 * length;
    return part;
  };
  at += 8 * numbers + 8 * count;
  const parts = { count, dialect, parents: words(count) };
  at += 4 * (fields + lists + strings);
  parts.twice = words(twice);
  parts.matches = readMatches(words(matches), selectors);
  parts.types = new Uint8Array(buffer, at, count);
  return parts;
}

// For each selector the numbers of the nodes that match.
function readMatches(words, selectors) {
  const matches = [];
  for (let at = 0, i = 0; i < selectors; i++) {
    matches.push(words.subarray(at + 1, at + 1 + words[at]));
    at += 1 + words[at];
  }
  return matches;
}

// Makes all the nodes of `tree`: src/jsc/bindings/LintNodes.cpp.
function makeNodes() {
  nodes = native.nodes(shapes[tree.dialect], leftOutBits[tree.dialect], buffers[AST], text, knownStrings);
}
