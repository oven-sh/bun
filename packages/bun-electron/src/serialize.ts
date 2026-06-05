// Structured-clone-ish serialization for IPC arguments, mirroring the
// renderer-side implementation embedded in native/renderer_bootstrap.h.
// Supports the types Electron apps commonly send beyond plain JSON:
// undefined, NaN/±Infinity, -0, BigInt, Date, RegExp, Map, Set, ArrayBuffer,
// TypedArrays (incl. Buffer, delivered as Uint8Array like Electron does).

const TAG = "$bunElectron";

export function encodeValue(value: unknown): unknown {
  if (value === undefined) return { [TAG]: "undefined" };
  if (typeof value === "number") {
    if (Number.isNaN(value)) return { [TAG]: "number", v: "nan" };
    if (value === Infinity) return { [TAG]: "number", v: "inf" };
    if (value === -Infinity) return { [TAG]: "number", v: "-inf" };
    if (Object.is(value, -0)) return { [TAG]: "number", v: "-0" };
    return value;
  }
  if (typeof value === "bigint") return { [TAG]: "bigint", v: value.toString() };
  if (value === null || typeof value !== "object") return value;

  if (value instanceof Date) return { [TAG]: "date", v: value.getTime() };
  if (value instanceof RegExp) return { [TAG]: "regexp", source: value.source, flags: value.flags };
  if (value instanceof Map) {
    return { [TAG]: "map", v: [...value.entries()].map(([k, v]) => [encodeValue(k), encodeValue(v)]) };
  }
  if (value instanceof Set) {
    return { [TAG]: "set", v: [...value.values()].map(encodeValue) };
  }
  if (value instanceof ArrayBuffer) {
    return { [TAG]: "arraybuffer", v: Buffer.from(value).toString("base64") };
  }
  if (ArrayBuffer.isView(value)) {
    const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    return { [TAG]: "typedarray", kind: value.constructor.name, v: bytes.toString("base64") };
  }
  if (Array.isArray(value)) return value.map(encodeValue);

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = encodeValue(v);
  // Escape objects that happen to use our tag key.
  if (TAG in out) return { [TAG]: "object", v: out };
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

export function decodeValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(decodeValue);

  const obj = value as Record<string, unknown>;
  const tag = obj[TAG];
  if (typeof tag !== "string") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = decodeValue(v);
    return out;
  }
  switch (tag) {
    case "undefined":
      return undefined;
    case "number":
      return obj.v === "nan" ? NaN : obj.v === "inf" ? Infinity : obj.v === "-inf" ? -Infinity : -0;
    case "bigint":
      return BigInt(obj.v as string);
    case "date":
      return new Date(obj.v as number);
    case "regexp":
      return new RegExp(obj.source as string, obj.flags as string);
    case "map":
      return new Map((obj.v as [unknown, unknown][]).map(([k, v]) => [decodeValue(k), decodeValue(v)]));
    case "set":
      return new Set((obj.v as unknown[]).map(decodeValue));
    case "arraybuffer":
      return base64ToBytes(obj.v as string).buffer;
    case "typedarray": {
      const bytes = base64ToBytes(obj.v as string);
      const kind = obj.kind as string;
      const Ctor = (globalThis as Record<string, unknown>)[kind] as
        | (new (b: ArrayBuffer) => ArrayBufferView)
        | undefined;
      if (!Ctor || kind === "Uint8Array" || kind === "Buffer") return bytes;
      return new Ctor(bytes.buffer as ArrayBuffer);
    }
    case "object": {
      const inner = obj.v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(inner)) out[k] = decodeValue(v);
      return out;
    }
    default:
      return obj;
  }
}

export function encodeArgs(args: unknown[]): string {
  return JSON.stringify(args.map(encodeValue));
}

export function decodeArgs(json: unknown): unknown[] {
  if (!Array.isArray(json)) return [];
  return json.map(decodeValue);
}
