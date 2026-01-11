/**
 * Shared PostgreSQL encoding utilities for binary COPY and array serialization
 */

// PostgreSQL type OID constants
export const TYPE_OID: Record<string, number> = {
  bool: 16,
  int2: 21,
  int4: 23,
  int8: 20,
  float4: 700,
  float8: 701,
  text: 25,
  varchar: 1043,
  bpchar: 1042,
  bytea: 17,
  date: 1082,
  time: 1083,
  timestamp: 1114,
  timestamptz: 1184,
  uuid: 2950,
  json: 114,
  jsonb: 3802,
  numeric: 1700,
  interval: 1186,
};

export const TYPE_ARRAY_OID: Record<string, number> = {
  "bool[]": 1000,
  "int2[]": 1005,
  "int4[]": 1007,
  "int8[]": 1016,
  "float4[]": 1021,
  "float8[]": 1022,
  "text[]": 1009,
  "varchar[]": 1015,
  "bpchar[]": 1014,
  "bytea[]": 1001,
  "date[]": 1182,
  "time[]": 1183,
  "timestamp[]": 1115,
  "timestamptz[]": 1185,
  "uuid[]": 2951,
  "json[]": 199,
  "jsonb[]": 3807,
  "numeric[]": 1231,
  "interval[]": 1187,
};

// Binary encoding helpers
const encText = new TextEncoder();

export function be16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setInt16(0, n, false);
  return b;
}

export function be32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, n, false);
  return b;
}

export function be64(big: bigint): Uint8Array {
  const b = new Uint8Array(8);
  const dv = new DataView(b.buffer);
  dv.setInt32(0, Number((big >> 32n) & 0xffffffffn), false);
  dv.setUint32(4, Number(big & 0xffffffffn), false);
  return b;
}

// Escape functions for PostgreSQL text format
export function copyTextEscape(s: string): string {
  // COPY text format escaping: backslash, tab, newline, carriage return
  return s.replaceAll("\\", "\\\\").replaceAll("\t", "\\t").replaceAll("\n", "\\n").replaceAll("\r", "\\r");
}

export function arrayEscape(value: string): string {
  // Array element escaping: backslash and double quotes
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function csvQuote(s: string): string {
  return `"${s.replaceAll('"', '""')}"`;
}

/**
 * Determine if a CSV field requires quoting based on RFC-like rules:
 * quote when it contains a double-quote, newline, carriage return, or the delimiter.
 */
export function needsCsvQuote(s: string, delimiter: string = ","): boolean {
  return s.includes('"') || s.includes("\n") || s.includes("\r") || s.includes(delimiter);
}

// Numeric encoding for PostgreSQL binary format
function expandExponent(s: string): string {
  const m = s.match(/^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
  if (!m) return s;
  const sign = m[1] === "-" ? "-" : "";
  let intPart = m[2] || "0";
  let fracPart = m[3] || "";
  const exp = Number(m[4]) | 0;
  if (exp > 0) {
    const needed = exp - fracPart.length;
    if (needed >= 0) {
      intPart = intPart + fracPart + "0".repeat(needed);
      fracPart = "";
    } else {
      intPart = intPart + fracPart.slice(0, exp);
      fracPart = fracPart.slice(exp);
    }
  } else if (exp < 0) {
    const zeros = "0".repeat(Math.max(0, -exp - intPart.length));
    const all = zeros ? zeros + intPart : intPart;
    const idx = all.length + exp;
    fracPart = all.slice(idx) + fracPart;
    intPart = all.slice(0, idx) || "0";
  }
  intPart = intPart.replace(/^0+/, "") || "0";
  return fracPart ? `${sign}${intPart}.${fracPart}` : `${sign}${intPart}`;
}

export function encodeNumericBinary(val: any): Uint8Array {
  let s = typeof val === "bigint" ? val.toString() : typeof val === "number" ? val.toString() : String(val);
  s = s.trim();
  if (!/^-?(\d+)(\.\d+)?([eE][+-]?\d+)?$/.test(s)) {
    throw new Error("numeric: value must be a plain decimal string/number");
  }
  if (/[eE]/.test(s)) s = expandExponent(s);
  let sign = 0x0000;
  if (s.startsWith("-")) {
    sign = 0x4000;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  let intPart = s;
  let fracPart = "";
  const dot = s.indexOf(".");
  if (dot !== -1) {
    intPart = s.slice(0, dot);
    fracPart = s.slice(dot + 1);
  }
  intPart = intPart.replace(/^0+/, "") || "0";
  const padLeft = (4 - (intPart.length % 4)) % 4;
  const intPadded = "0".repeat(padLeft) + intPart;
  const intGroups: number[] = [];
  for (let i = 0; i < intPadded.length; i += 4) {
    intGroups.push(parseInt(intPadded.slice(i, i + 4), 10) || 0);
  }
  const dscale = fracPart.length;
  const padRight = (4 - (fracPart.length % 4)) % 4;
  const fracPadded = fracPart + "0".repeat(padRight);
  const fracGroups: number[] = [];
  for (let i = 0; i < fracPadded.length; i += 4) {
    if (i < fracPart.length || padRight > 0) {
      const g = fracPadded.slice(i, i + 4);
      fracGroups.push(parseInt(g, 10) || 0);
    }
  }
  while (intGroups.length > 0 && intGroups[0] === 0) intGroups.shift();
  let weight = intGroups.length - 1;
  let digits = intGroups.concat(fracGroups);
  while (digits.length > 0 && digits[digits.length - 1] === 0) digits.pop();
  if (digits.length === 0) {
    const out = new Uint8Array(8);
    const dv = new DataView(out.buffer);
    dv.setInt16(0, 0, false);
    dv.setInt16(2, 0, false);
    dv.setInt16(4, 0x0000, false);
    dv.setInt16(6, dscale | 0, false);
    return out;
  }
  const ndigits = digits.length;
  const out = new Uint8Array(8 + ndigits * 2);
  const dv = new DataView(out.buffer);
  dv.setInt16(0, ndigits, false);
  dv.setInt16(2, weight, false);
  dv.setInt16(4, sign, false);
  dv.setInt16(6, dscale | 0, false);
  let o = 8;
  for (let i = 0; i < ndigits; i++) {
    dv.setInt16(o, digits[i], false);
    o += 2;
  }
  return out;
}

export function encodeIntervalBinary(val: any): Uint8Array {
  let months = 0,
    days = 0;
  let micros = 0n;
  if (val && typeof val === "object") {
    if ("months" in val) months = Number((val as any).months) | 0;
    if ("days" in val) days = Number((val as any).days) | 0;
    if ("micros" in val) micros = BigInt((val as any).micros);
    else if ("ms" in val) micros = BigInt(Math.trunc((val as any).ms)) * 1000n;
    else if ("seconds" in val) micros = BigInt(Math.trunc((val as any).seconds)) * 1_000_000n;
  } else if (typeof val === "string") {
    const m = val.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/);
    if (m) {
      const hh = Number(m[1]) | 0,
        mm = Number(m[2]) | 0,
        ss = Number(m[3]) | 0;
      const frac = (m[4] || "").padEnd(6, "0").slice(0, 6);
      const us = Number(frac) | 0;
      micros = BigInt((hh * 3600 + mm * 60 + ss) * 1_000_000 + us);
    } else {
      micros = 0n;
    }
  } else if (typeof val === "number") {
    micros = BigInt(Math.trunc(val)) * 1000n;
  }
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  dv.setInt32(0, Number((micros >> 32n) & 0xffffffffn), false);
  dv.setUint32(4, Number(micros & 0xffffffffn), false);
  dv.setInt32(8, days, false);
  dv.setInt32(12, months, false);
  return out;
}

export type CopyBinaryBaseType =
  | "bool"
  | "int2"
  | "int4"
  | "int8"
  | "float4"
  | "float8"
  | "text"
  | "varchar"
  | "bpchar"
  | "bytea"
  | "date"
  | "time"
  | "timestamp"
  | "timestamptz"
  | "uuid"
  | "json"
  | "jsonb"
  | "numeric"
  | "interval";

export type CopyBinaryArrayType = `${CopyBinaryBaseType}[]`;
export type CopyBinaryType = CopyBinaryBaseType | CopyBinaryArrayType;

/**
 * Encode a single value in PostgreSQL binary format for COPY
 */
export function encodeBinaryValue(v: unknown, t: CopyBinaryType): Uint8Array {
  // Handle arrays like "int4[]"
  if (t.endsWith("[]")) {
    const base = t.slice(0, -2) as CopyBinaryBaseType;
    if (!Array.isArray(v)) throw new Error("binary array expects a JavaScript array value");
    return encodeArray1D(v, base);
  }
  switch (t) {
    case "bool": {
      const out = new Uint8Array(1);
      out[0] = v ? 1 : 0;
      return out;
    }
    case "int2": {
      const b = new Uint8Array(2);
      new DataView(b.buffer).setInt16(0, Number(v) | 0, false);
      return b;
    }
    case "int4": {
      const b = new Uint8Array(4);
      new DataView(b.buffer).setInt32(0, Number(v) | 0, false);
      return b;
    }
    case "int8": {
      const b = new Uint8Array(8);
      const dv = new DataView(b.buffer);
      const big = BigInt(v as string | number | bigint | boolean);
      dv.setInt32(0, Number((big >> 32n) & 0xffffffffn), false);
      dv.setUint32(4, Number(big & 0xffffffffn), false);
      return b;
    }
    case "float4": {
      const b = new Uint8Array(4);
      new DataView(b.buffer).setFloat32(0, Number(v), false);
      return b;
    }
    case "float8": {
      const b = new Uint8Array(8);
      new DataView(b.buffer).setFloat64(0, Number(v), false);
      return b;
    }
    case "bytea": {
      if (v instanceof Uint8Array) return v;
      if (v && (v as any).byteLength !== undefined) return new Uint8Array(v as ArrayBuffer);
      const s = typeof v === "string" ? v : v == null ? "" : String(v);
      return encText.encode(s);
    }
    case "date": {
      // int32 days since 2000-01-01
      const epoch2000 = Date.UTC(2000, 0, 1);
      let ms: number;
      if (v instanceof Date) ms = v.getTime();
      else if (typeof v === "number") ms = v;
      else ms = new Date(String(v)).getTime();
      const days = Math.floor((ms - epoch2000) / 86400000);
      const b = new Uint8Array(4);
      new DataView(b.buffer).setInt32(0, days, false);
      return b;
    }
    case "time": {
      // int64 microseconds since midnight
      const toMicros = (val: any): bigint => {
        if (typeof val === "number") return BigInt(Math.floor(val));
        if (val instanceof Date) {
          const h = val.getUTCHours();
          const m = val.getUTCMinutes();
          const s = val.getUTCSeconds();
          const ms = val.getUTCMilliseconds();
          return BigInt(((h * 3600 + m * 60 + s) * 1000 + ms) * 1000);
        }
        const str = String(val);
        const m = str.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/);
        if (!m) return 0n;
        const hh = Number(m[1]) | 0;
        const mm = Number(m[2]) | 0;
        const ss = Number(m[3]) | 0;
        const frac = (m[4] || "").padEnd(6, "0").slice(0, 6);
        const us = Number(frac) | 0;
        return BigInt((hh * 3600 + mm * 60 + ss) * 1_000_000 + us);
      };
      const micros = toMicros(v);
      const b = new Uint8Array(8);
      const dv = new DataView(b.buffer);
      dv.setInt32(0, Number((micros >> 32n) & 0xffffffffn), false);
      dv.setUint32(4, Number(micros & 0xffffffffn), false);
      return b;
    }
    case "timestamp":
    case "timestamptz": {
      // int64 microseconds since 2000-01-01 UTC
      const epoch2000 = Date.UTC(2000, 0, 1);
      let ms: number;
      if (v instanceof Date) ms = v.getTime();
      else if (typeof v === "number") ms = v;
      else ms = new Date(String(v)).getTime();
      const micros = BigInt(Math.round((ms - epoch2000) * 1000));
      const b = new Uint8Array(8);
      const dv = new DataView(b.buffer);
      dv.setInt32(0, Number((micros >> 32n) & 0xffffffffn), false);
      dv.setUint32(4, Number(micros & 0xffffffffn), false);
      return b;
    }
    case "uuid": {
      // 16 bytes
      const s = String(v).toLowerCase();
      const hex = s.replace(/-/g, "");
      const out = new Uint8Array(16);
      for (let i = 0; i < 16; i++) {
        const byte = hex.slice(i * 2, i * 2 + 2);
        out[i] = parseInt(byte, 16) || 0;
      }
      return out;
    }
    case "json": {
      const s = typeof v === "string" ? v : JSON.stringify(v ?? null);
      return encText.encode(s);
    }
    case "jsonb": {
      const s = typeof v === "string" ? v : JSON.stringify(v ?? null);
      const txt = encText.encode(s);
      // version 1 + textual json
      const out = new Uint8Array(1 + txt.length);
      out[0] = 1;
      out.set(txt, 1);
      return out;
    }
    case "numeric": {
      return encodeNumericBinary(v);
    }
    case "interval": {
      return encodeIntervalBinary(v);
    }
    case "varchar":
    case "bpchar":
    case "text":
    default: {
      // default to text encoding for unknown types
      const s = typeof v === "string" ? v : v == null ? "" : String(v);
      return encText.encode(s);
    }
  }
}

/**
 * Encode a 1-dimensional array in PostgreSQL binary format
 */
export function encodeArray1D(arr: unknown[], elemType: CopyBinaryBaseType): Uint8Array {
  const oid = TYPE_OID[elemType];
  if (!oid) throw new Error(`Unsupported array base type for binary encoding: ${elemType}`);
  const n = arr.length;
  let hasNull = 0;
  const elems: Uint8Array[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    if (v === null || v === undefined) {
      elems[i] = new Uint8Array(0);
      hasNull = 1;
    } else {
      elems[i] = encodeBinaryValue(v, elemType);
    }
  }
  let size = 4 * 3 + 8; // ndim, hasnull, oid, dim length + lbound
  for (let i = 0; i < n; i++) {
    size += 4 + (elems[i].length || 0);
  }
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  let o = 0;
  dv.setInt32(o, 1, false); // ndim
  o += 4;
  dv.setInt32(o, hasNull, false);
  o += 4;
  dv.setInt32(o, oid, false);
  o += 4;
  dv.setInt32(o, n, false); // length
  o += 4;
  dv.setInt32(o, 1, false); // lbound
  o += 4;
  for (let i = 0; i < n; i++) {
    if (arr[i] === null || arr[i] === undefined) {
      dv.setInt32(o, -1, false);
      o += 4;
    } else {
      const b = elems[i];
      dv.setInt32(o, b.length, false);
      o += 4;
      out.set(b, o);
      o += b.length;
    }
  }
  return out;
}

/**
 * Encode a binary COPY row with the given types
 */
export function encodeBinaryRow(row: any[], types: CopyBinaryType[]): Uint8Array {
  const fieldCount = types.length;
  // First pass: compute total size
  let size = 2; // int16 field count
  const vals: Uint8Array[] = new Array(fieldCount);
  for (let i = 0; i < fieldCount; i++) {
    const val = row[i];
    if (val === null || val === undefined) {
      size += 4; // -1 length
      vals[i] = new Uint8Array(0);
      continue;
    }
    const t = types[i];
    const bytes = encodeBinaryValue(val, t);
    vals[i] = bytes;
    size += 4 + bytes.length;
  }
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  let o = 0;
  dv.setInt16(o, fieldCount, false);
  o += 2;
  for (let i = 0; i < fieldCount; i++) {
    const v = row[i];
    if (v === null || v === undefined) {
      dv.setInt32(o, -1, false);
      o += 4;
      continue;
    }
    const bytes = vals[i];
    dv.setInt32(o, bytes.length, false);
    o += 4;
    out.set(bytes, o);
    o += bytes.length;
  }
  return out;
}

/**
 * Create binary COPY header
 */
export function createBinaryCopyHeader(): Uint8Array {
  const sig = new Uint8Array([0x50, 0x47, 0x43, 0x4f, 0x50, 0x59, 0x0a, 0xff, 0x0d, 0x0a, 0x00]);
  const flags = new Uint8Array(4); // 0
  const extlen = new Uint8Array(4); // 0
  const out = new Uint8Array(sig.length + flags.length + extlen.length);
  out.set(sig, 0);
  out.set(flags, sig.length);
  out.set(extlen, sig.length + flags.length);
  return out;
}

/**
 * Create binary COPY trailer
 */
export function createBinaryCopyTrailer(): Uint8Array {
  // int16 -1 (0xFFFF) big-endian
  return new Uint8Array([0xff, 0xff]);
}
