interface Transpiler {
  $unstableParseNative(code: any, opts: any): any;
}

export function unstableParse(this: Transpiler, code: any, opts: any) {
  // Native throws on every failure path and otherwise returns {buffer: ArrayBuffer}.
  const buffer: ArrayBuffer = this.$unstableParseNative(code, opts).buffer;
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== 0x42554e41) throw new TypeError("unstable_parse: bad buffer magic");
  const version = dv.getUint32(4, true);
  if (version !== 1) throw new TypeError("unstable_parse: unsupported buffer version " + version);
  const rootOffset = dv.getUint32(8, true);
  const stringsOffset = dv.getUint32(12, true);
  const keyTableLen = dv.getUint32(20, true);
  const keyTableOffset = stringsOffset - keyTableLen * 8;

  const bytes = new Uint8Array(buffer);
  // ignoreBOM: the string pool holds arbitrary content, not a BOM-prefixed stream.
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  const stringCache = new $Map<number, string>();
  const string16Cache = new $Map<number, string>();
  const nodeCache = new $Map<number, any>();
  const arrayCache = new $Map<number, any>();

  const readString = (off: number, len: number): string => {
    // `intern_str(b"")` does not advance the pool cursor, so an empty string shares its offset with the next entry.
    if (len === 0) return "";
    let s = stringCache.$get(off);
    if (s !== undefined) return s;
    s = decoder.decode(bytes.subarray(stringsOffset + off, stringsOffset + off + len));
    stringCache.$set(off, s);
    return s;
  };

  // Per-code-unit decode so lone surrogates survive (matches object-mode `str16`).
  const readString16 = (off: number, len: number): string => {
    if (len === 0) return "";
    let s = string16Cache.$get(off);
    if (s !== undefined) return s;
    const base = stringsOffset + off;
    const n = len >>> 1;
    // Chunked to stay under JSC's apply-argument cap (src/node-fallbacks/buffer.js does the same).
    s = "";
    for (let i = 0; i < n; ) {
      const end = i + 0x1000 < n ? i + 0x1000 : n;
      const units = new $Array(end - i);
      for (let j = 0; i < end; i++, j++) units[j] = dv.getUint16(base + i * 2, true);
      s += String.fromCharCode.$apply(null, units);
    }
    string16Cache.$set(off, s);
    return s;
  };

  const keyNames = new $Array(keyTableLen);
  for (let i = 0; i < keyTableLen; i++) {
    const base = keyTableOffset + i * 8;
    keyNames[i] = readString(dv.getUint32(base, true), dv.getUint32(base + 4, true));
  }

  // tyAt: byte offset of the type tag (1 for node fields, 0 for array elements).
  const decodePayload = (base: number, tyAt: number): any => {
    const ty = dv.getUint8(base + tyAt);
    switch (ty) {
      case 0:
        return null;
      case 1:
        return false;
      case 2:
        return true;
      case 3:
        return dv.getInt32(base + 4, true);
      case 4:
        return dv.getFloat64(base + 4, true);
      case 5:
        return readString(dv.getUint32(base + 4, true), dv.getUint32(base + 8, true));
      case 6:
        return nodeAt(dv.getUint32(base + 4, true));
      case 7:
        return arrayAt(dv.getUint32(base + 4, true));
      case 8:
        return readString16(dv.getUint32(base + 4, true), dv.getUint32(base + 8, true));
      default:
        return undefined;
    }
  };

  const ownKeysOf = (off: number): string[] => {
    const n = dv.getUint16(off, true);
    const keys = new $Array(n);
    for (let i = 0; i < n; i++) keys[i] = keyNames[dv.getUint8(off + 4 + i * 12)];
    return keys;
  };

  const jsonify = (v: any): any => {
    if (v === null || typeof v !== "object") return v;
    const off = v.__off;
    if (typeof off !== "number") return v;
    if ($isArray(v)) {
      const n = dv.getUint32(off, true);
      const out = new $Array(n);
      for (let i = 0; i < n; i++) out[i] = jsonify(decodePayload(off + 4 + i * 12, 0));
      return out;
    }
    const out: Record<string, unknown> = {};
    const n = dv.getUint16(off, true);
    let p = off + 4;
    for (let i = 0; i < n; i++, p += 12) out[keyNames[dv.getUint8(p)]] = jsonify(decodePayload(p, 1));
    return out;
  };

  function toJSON(this: { __off: number }) {
    return jsonify(this);
  }

  const nodeHandler: ProxyHandler<{ __off: number }> = {
    get(target, prop) {
      if (prop === "__off") return target.__off;
      if (prop === "toJSON") return toJSON;
      if (typeof prop === "string") {
        const off = target.__off;
        const n = dv.getUint16(off, true);
        let p = off + 4;
        for (let i = 0; i < n; i++, p += 12) {
          if (keyNames[dv.getUint8(p)] === prop) return decodePayload(p, 1);
        }
      }
      // Fall through so toString/valueOf/@@toPrimitive/hasOwnProperty resolve via the target's prototype.
      return Reflect.get(target, prop);
    },
    has(target, prop) {
      if (prop === "toJSON" || prop === "__off") return true;
      if (typeof prop === "string") {
        const off = target.__off;
        const n = dv.getUint16(off, true);
        let p = off + 4;
        for (let i = 0; i < n; i++, p += 12) {
          if (keyNames[dv.getUint8(p)] === prop) return true;
        }
      }
      return Reflect.has(target, prop);
    },
    ownKeys(target) {
      return ownKeysOf(target.__off);
    },
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop !== "string") return undefined;
      const off = target.__off;
      const n = dv.getUint16(off, true);
      let p = off + 4;
      for (let i = 0; i < n; i++, p += 12) {
        if (keyNames[dv.getUint8(p)] === prop) {
          return { enumerable: true, configurable: true, writable: false, value: decodePayload(p, 1) };
        }
      }
      return undefined;
    },
    set() {
      return false;
    },
    defineProperty() {
      return false;
    },
    deleteProperty() {
      return false;
    },
  };

  const nodeAt = (off: number): any => {
    let p = nodeCache.$get(off);
    if (p !== undefined) return p;
    p = new Proxy({ __off: off }, nodeHandler);
    nodeCache.$set(off, p);
    return p;
  };

  const arrayHandler: ProxyHandler<any[] & { __off: number }> = {
    get(target, prop, recv) {
      const off = target.__off;
      if (prop === "length") return dv.getUint32(off, true);
      if (prop === "__off") return off;
      if (prop === "toJSON") return toJSON;
      if (typeof prop === "string") {
        const i = +prop;
        if (i >= 0 && (i | 0) === i && "" + i === prop) {
          const count = dv.getUint32(off, true);
          if (i >= count) return undefined;
          return decodePayload(off + 4 + i * 12, 0);
        }
      }
      return Reflect.get(target, prop, recv);
    },
    has(target, prop) {
      if (prop === "length" || prop === "__off" || prop === "toJSON") return true;
      if (typeof prop === "string") {
        const i = +prop;
        if (i >= 0 && (i | 0) === i && "" + i === prop) return i < dv.getUint32(target.__off, true);
      }
      return Reflect.has(target, prop);
    },
    ownKeys(target) {
      const count = dv.getUint32(target.__off, true);
      const keys = new $Array(count + 1);
      for (let i = 0; i < count; i++) keys[i] = "" + i;
      keys[count] = "length";
      return keys;
    },
    getOwnPropertyDescriptor(target, prop) {
      const off = target.__off;
      if (prop === "length") {
        return { enumerable: false, configurable: false, writable: true, value: dv.getUint32(off, true) };
      }
      if (typeof prop === "string") {
        const i = +prop;
        if (i >= 0 && (i | 0) === i && "" + i === prop) {
          if (i >= dv.getUint32(off, true)) return undefined;
          return { enumerable: true, configurable: true, writable: false, value: decodePayload(off + 4 + i * 12, 0) };
        }
      }
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    set() {
      return false;
    },
    defineProperty() {
      return false;
    },
    deleteProperty() {
      return false;
    },
  };

  const arrayAt = (off: number): any => {
    let p = arrayCache.$get(off);
    if (p !== undefined) return p;
    const target: any = [];
    target.__off = off;
    p = new Proxy(target, arrayHandler);
    arrayCache.$set(off, p);
    return p;
  };

  // Dispatches on node.kind; a handler returning false skips children.
  const visitNode = (off: number, visitors: any, enter: any): void => {
    const n = dv.getUint16(off, true);
    let p = off + 4;
    // Kind-less helper nodes (g_decl, g_arg, catch, ...) are traversed but never dispatched.
    let fn: any;
    if (dv.getUint8(p) === 0 && dv.getUint8(p + 1) === 5) {
      const kind = readString(dv.getUint32(p + 4, true), dv.getUint32(p + 8, true));
      fn = visitors[kind] ?? enter;
    }
    if (fn !== undefined && fn.$call(undefined, nodeAt(off)) === false) return;
    for (let i = 0; i < n; i++, p += 12) {
      const ty = dv.getUint8(p + 1);
      if (ty === 6) {
        visitNode(dv.getUint32(p + 4, true), visitors, enter);
      } else if (ty === 7) {
        const aoff = dv.getUint32(p + 4, true);
        const count = dv.getUint32(aoff, true);
        let ap = aoff + 4;
        for (let j = 0; j < count; j++, ap += 12) {
          if (dv.getUint8(ap) === 6) visitNode(dv.getUint32(ap + 4, true), visitors, enter);
        }
      }
    }
  };

  const visit = (visitors: any) => {
    const enter = visitors.enter;
    const stmts = nodeAt(rootOffset).stmts;
    const count = stmts.length;
    for (let i = 0; i < count; i++) visitNode(stmts[i].__off, visitors, enter);
  };

  return { buffer, root: nodeAt(rootOffset), visit };
}
