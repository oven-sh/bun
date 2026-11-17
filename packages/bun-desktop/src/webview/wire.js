// The other side of src/desktop/webview/wire.rs. The web engine runs this text, up to the last line.
const MAX_MESSAGE = 1 << 30;
const MAX_VALUE_DEPTH = 1000;
const views = {
  __proto__: null,
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
  DataView,
  Buffer:
    globalThis.Buffer &&
    function (bytes) {
      return Buffer.from(bytes);
    },
};
const errors = { __proto__: null, Error, EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError };
const { apply } = Reflect;
const tagOf = value => apply(Object.prototype.toString, value, []).slice(8, -1);

const lengthAt = (bytes, offset) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(offset, true);

function concat(chunks) {
  const all = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  chunks.reduce((at, chunk) => (all.set(chunk, at), at + chunk.length), 0);
  return all;
}

/** What `structuredClone` copies. `handleOf` names the objects that stay where they are. */
function encode(root, handleOf) {
  const seen = new Map();
  const chunks = new Array();
  let size = 0;
  function bytes(buffer, offset, length) {
    chunks.push(new Uint8Array(buffer, offset, length));
    return [(size += length) - length, length];
  }
  let visit;
  visit = (value, depth) => {
    if (value === null) return value;
    switch (typeof value) {
      case "string":
      case "boolean":
        return value;
      case "number":
        return Number.isFinite(value) && !Object.is(value, -0)
          ? value
          : ["n", Object.is(value, -0) ? "-0" : String(value)];
      case "undefined":
        return ["u"];
      case "bigint":
        return ["i", String(value)];
    }
    const handle = handleOf && handleOf(value);
    if (handle !== undefined) return ["h", visit(handle, depth + 1)];
    if (typeof value !== "object" || depth > MAX_VALUE_DEPTH) throw new Error("An object could not be cloned.");
    if (seen.has(value)) return ["r", seen.get(value)];
    seen.set(value, seen.size);
    const each = list => Array.from(list, it => visit(it, depth + 1));
    if (Array.isArray(value)) return ["a", ...each(value)];
    const tag = tagOf(value);
    if (ArrayBuffer.isView(value)) {
      return [
        "v",
        globalThis.Buffer?.isBuffer(value) ? "Buffer" : tag,
        ...bytes(value.buffer, value.byteOffset, value.byteLength),
      ];
    }
    if (tag === "ArrayBuffer") return ["b", ...bytes(value, 0, value.byteLength)];
    if (tag === "Date") return ["d", visit(+value, depth)];
    if (tag === "RegExp") return ["x", value.source, value.flags];
    if (tag === "Map") return ["m", ...each([...value].flat())];
    if (tag === "Set") return ["s", ...each(value)];
    if (tag === "Error") return ["e", String(value.name), String(value.message), String(value.stack)];
    return ["o", ...Object.keys(value).flatMap(key => [key, visit(value[key], depth + 1)])];
  };
  const json = new TextEncoder().encode(JSON.stringify(visit(root, 0)));
  const head = new DataView(new ArrayBuffer(8));
  head.setUint32(0, 4 + json.length + size, true);
  head.setUint32(4, json.length, true);
  return concat([new Uint8Array(head.buffer), json, ...chunks]);
}

/** `message` is without its length. */
function decode(message, fromHandle) {
  const end = 4 + lengthAt(message, 0);
  const seen = new Array();
  const keep = value => (seen.push(value), value);
  const bytes = (offset, length) => new Uint8Array(message.subarray(end + offset, end + offset + length)).buffer;
  let visit;
  visit = value => {
    if (!Array.isArray(value)) return value;
    const [tag, first, second, third] = value;
    switch (tag) {
      case "n":
        return Number(first);
      case "u":
        return undefined;
      case "i":
        return BigInt(first);
      case "h":
        return fromHandle(visit(first));
      case "r":
        return seen[first];
      case "b":
        return keep(bytes(first, second));
      case "v":
        return keep(new (views[first] ?? Uint8Array)(bytes(second, third)));
      case "d":
        return keep(new Date(visit(first)));
      case "x":
        return keep(new RegExp(first, second));
      case "e":
        return keep(Object.assign(new (errors[first] ?? Error)(second), { name: first, stack: third }));
    }
    const result = keep(tag === "a" ? [] : tag === "m" ? new Map() : tag === "s" ? new Set() : {});
    for (let i = 1; i < value.length; i++) {
      if (tag === "a") result.push(visit(value[i]));
      else if (tag === "s") result.add(visit(value[i]));
      else if (tag === "m") result.set(visit(value[i]), visit(value[++i]));
      else {
        const own = { value: visit(value[i + 1]), writable: true, enumerable: true, configurable: true };
        Object.defineProperty(result, value[i++], own);
      }
    }
    return result;
  };
  return visit(JSON.parse(new TextDecoder().decode(message.subarray(4, end))));
}

/** Takes what a stream reads, and gives whole messages. */
function splitter(receive) {
  let chunks = new Array();
  let have = 0;
  let wanted = 4;
  return chunk => {
    chunks.push(chunk);
    have += chunk.length;
    while (have >= wanted) {
      const all = chunks.length === 1 ? chunks[0] : concat(chunks);
      chunks = [all];
      wanted = 4 + lengthAt(all, 0);
      if (wanted > MAX_MESSAGE) throw new RangeError("The message is too large");
      if (have < wanted) return;
      const message = all.subarray(4, wanted);
      chunks = [all.subarray(wanted)];
      have -= wanted;
      wanted = 4;
      try {
        receive(message);
      } catch (error) {
        setImmediate(() => {
          throw error;
        });
      }
    }
  };
}

export default { encode, decode, splitter };
