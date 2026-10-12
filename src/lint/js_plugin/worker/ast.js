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
// By dialect and type: `{ name, fields, leftOut, prototype }`. `leftOut`: a bit for each field that a node does not have at all if
// there is nothing to say.
const kinds = [[], []];
// For `native.nodes`, by dialect and type: what `native.shape` has made, and `leftOut`.
const shapes = [[], []];
const leftOutBits = [new Uint32Array(256), new Uint32Array(256)];
let knownStrings = [];

// The arrays of the file.
let tree = null;
// The nodes of the file, by their number.
let nodes = [];

class Node {
  get loc() {
    const loc = { start: locationOf(this.range[0]), end: locationOf(this.range[1]) };
    Object.defineProperty(this, "loc", { value: loc, writable: true, enumerable: true, configurable: true });
    return loc;
  }
  set loc(loc) {
    Object.defineProperty(this, "loc", { value: loc, writable: true, enumerable: true, configurable: true });
  }
}

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
      const kind = { name, fields: names, leftOut: 0, prototype: Object.create(Node.prototype) };
      for (const field of some) kind.leftOut |= 1 << names.indexOf(field);
      kinds[dialect][id] = kind;
      if (native !== undefined) {
        const shapeWith = which => {
          const has = field => !some.includes(field) || ((which >> some.indexOf(field)) & 1) === 1;
          return native.shape(kind.prototype, ["type", ...names.filter(has), "start", "end", "range", "parent"], name);
        };
        shapes[dialect][id] =
          some.length === 0 ? shapeWith(0) : Array.from({ length: 1 << some.length }, (_, it) => shapeWith(it));
        leftOutBits[dialect][id] = kind.leftOut;
      }
      if (dialect === 1) continue;
      for (const [key, get] of Object.entries(deprecated[name] ?? {})) {
        Object.defineProperty(kind.prototype, key, {
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

function stringAt(index) {
  const start = tree.strings[2 * index];
  const end = tree.strings[2 * index + 1];
  if (start >= 0x80000000) {
    tree.extraText ??= decode(tree.extra.buffer, tree.extra.byteOffset, tree.extra.byteOffset + tree.extra.byteLength);
    return tree.extraText.slice(start - 0x80000000, end);
  }
  return text.slice(start, end);
}

// What a word stands for, in a node from `start` to `end`.
function value(word, start, end) {
  const number = word >>> 4;
  switch (word & 15) {
    case 0:
      switch (number) {
        case 0:
          return undefined;
        case 1:
          return null;
        case 2:
          return false;
        case 3:
          return true;
        case 4:
          return text.slice(start, end);
        default:
          return text.slice(start + 1, end - 1);
      }
    case 1:
      return nodes[number];
    case 2: {
      const lists = tree.lists;
      const length = lists[number];
      const list = new Array(length);
      for (let i = 0; i < length; i++) {
        const id = lists[number + 1 + i];
        list[i] = id === 0 ? null : nodes[id];
      }
      return list;
    }
    case 3:
      return stringAt(number);
    case 4:
      return knownStrings[number];
    case 5:
      return number;
    case 6:
      return tree.numbers[number];
    case 7: {
      let string = "";
      for (let i = 1; i <= tree.lists[number]; i++) string += String.fromCharCode(tree.lists[number + i]);
      return string;
    }
    case 8:
      try {
        return new RegExp(value(tree.lists[number], start, end), value(tree.lists[number + 1], start, end));
      } catch {
        return null;
      }
    case 9:
      return { pattern: value(tree.lists[number], start, end), flags: value(tree.lists[number + 1], start, end) };
    case 10:
      return { cooked: value(tree.lists[number], start, end), raw: value(tree.lists[number + 1], start, end) };
    default:
      return BigInt(value(tree.lists[number], start, end));
  }
}

// Takes apart the message that `ast.rs` writes. `selectors`: how many were to be matched.
function readTree(buffer, selectors) {
  const header = new Uint32Array(buffer, 0, 10);
  const [count, fields, lists, strings, twice, matches, numbers, extra, dialect] = header;
  let at = 40;
  const words = length => {
    const part = new Uint32Array(buffer, at, length);
    at += 4 * length;
    return part;
  };
  const parts = { count, dialect, numbers: new Float64Array(buffer, at, numbers), extraText: undefined };
  at += 8 * numbers;
  parts.starts = words(count);
  parts.ends = words(count);
  parts.parents = words(count);
  parts.fields = words(fields);
  parts.lists = words(lists);
  parts.strings = words(strings);
  parts.twice = words(twice);
  parts.matches = readMatches(words(matches), selectors);
  parts.types = new Uint8Array(buffer, at, count);
  parts.extra = new Uint8Array(buffer, at + count, extra);
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

// Makes all the nodes of `tree`.
function makeNodes() {
  const { count, types, starts, ends, parents, fields, dialect } = tree;
  if (native !== undefined) {
    nodes = native.nodes(shapes[dialect], leftOutBits[dialect], buffers[AST], text, knownStrings, value);
    return;
  }
  // The same, where that is not there: src/jsc/bindings/LintNodes.cpp.
  const byType = kinds[dialect];
  // Where the words of each node start.
  const offsets = new Uint32Array(count);
  for (let id = 0, at = 0; id < count; id++) {
    offsets[id] = at;
    at += byType[types[id]].fields.length;
  }
  nodes = new Array(count);
  // What is in a node has a higher number.
  for (let id = count - 1; id >= 0; id--) {
    const kind = byType[types[id]];
    const [at, start, end] = [offsets[id], starts[id], ends[id]];
    const node = Object.create(kind.prototype);
    node.type = kind.name;
    kind.fields.forEach((field, i) => {
      if (fields[at + i] !== 0 || ((kind.leftOut >> i) & 1) === 0) node[field] = value(fields[at + i], start, end);
    });
    nodes[id] = Object.assign(node, { start, end, range: [start, end], parent: null });
  }
  for (let id = 1; id < count; id++) nodes[id].parent = nodes[parents[id]];
}
