// Prototype: JS-object spans serialized to protobuf in a shared Uint8Array at end().
import { bench, group, run } from "mitata";

const tape = new Uint8Array(1 << 20);
let off = 0;
let s0 = 0x9e3779b9 | 0, s1 = 0x243f6a88 | 0, s2 = 0xb7e15162 | 0, s3 = 0x6a09e667 | 0;
function rnd() { // xoshiro128** on int32
  const r = Math.imul(s1 * 5, 7) | 0; // simplified
  const t = s1 << 9;
  s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t; s3 = (s3 << 11) | (s3 >>> 21);
  return r;
}
const now = performance.now.bind(performance);
const origin = performance.timeOrigin;

class Span {
  constructor(name, parent) {
    this.name = name;
    this.kind = 0;
    if (parent) { this.t0 = parent.t0; this.t1 = parent.t1; this.t2 = parent.t2; this.t3 = parent.t3; this.p0 = parent.s0; this.p1 = parent.s1; }
    else { this.t0 = rnd(); this.t1 = rnd(); this.t2 = rnd(); this.t3 = rnd(); this.p0 = 0; this.p1 = 0; }
    this.s0 = rnd(); this.s1 = rnd();
    this.start = now();
    this.attrs = null;
    this.ended = false;
  }
  setAttribute(k, v) { (this.attrs ??= []).push(k, v); return this; }
  end() {
    if (this.ended) return;
    this.ended = true;
    serialize(this, now());
  }
}
function varint(v) { // v < 2^32
  while (v > 127) { tape[off++] = (v & 127) | 128; v >>>= 7; }
  tape[off++] = v;
}
function fixed32(v) { tape[off] = v & 255; tape[off + 1] = (v >>> 8) & 255; tape[off + 2] = (v >>> 16) & 255; tape[off + 3] = v >>> 24; off += 4; }
function timeNs(ms) { // epoch ms double -> fixed64 ns
  const ns = (origin + ms) * 1e6;
  const hi = Math.floor(ns / 4294967296);
  fixed32((ns - hi * 4294967296) >>> 0); fixed32(hi >>> 0);
}
function str(field, s) {
  const n = s.length;
  tape[off++] = (field << 3) | 2;
  // assume short ASCII for the prototype; real impl falls back to encodeInto
  const lenAt = off++;
  for (let i = 0; i < n; i++) tape[off++] = s.charCodeAt(i);
  tape[lenAt] = n;
}
function serialize(sp, endMs) {
  if (off > tape.length - 4096) off = 0; // prototype: wrap
  tape[off++] = (2 << 3) | 2; // Span field in ScopeSpans (len patched)
  const lenAt = off; off += 2; // 2-byte padded varint
  const body = off;
  tape[off++] = (1 << 3) | 2; tape[off++] = 16; fixed32(sp.t0); fixed32(sp.t1); fixed32(sp.t2); fixed32(sp.t3);
  tape[off++] = (2 << 3) | 2; tape[off++] = 8; fixed32(sp.s0); fixed32(sp.s1);
  if (sp.p0 | sp.p1) { tape[off++] = (4 << 3) | 2; tape[off++] = 8; fixed32(sp.p0); fixed32(sp.p1); }
  str(5, sp.name);
  tape[off++] = 6 << 3; tape[off++] = sp.kind + 1;
  tape[off++] = (7 << 3) | 1; timeNs(sp.start);
  tape[off++] = (8 << 3) | 1; timeNs(endMs);
  const a = sp.attrs;
  if (a !== null) {
    for (let i = 0; i < a.length; i += 2) {
      tape[off++] = (9 << 3) | 2; const kvLen = off++; const kv = off;
      str(1, a[i]);
      const v = a[i + 1];
      tape[off++] = (2 << 3) | 2; const avLen = off++; const av = off;
      switch (typeof v) {
        case "string": str(1, v); break;
        case "boolean": tape[off++] = 2 << 3; tape[off++] = v ? 1 : 0; break;
        case "number":
          if ((v | 0) === v) { tape[off++] = 3 << 3; varint(v >>> 0); } else { tape[off++] = (4 << 3) | 1; const f = new Float64Array(1); f[0] = v; tape.set(new Uint8Array(f.buffer), off); off += 8; }
          break;
      }
      tape[avLen] = off - av; tape[kvLen] = off - kv;
    }
  }
  const len = off - body;
  tape[lenAt] = (len & 127) | 128; tape[lenAt + 1] = len >>> 7;
}

group("proto", () => {
  bench("startSpan + 3 attributes + end (JS tape)", () => {
    const s = new Span("op", null);
    s.setAttribute("a", 1); s.setAttribute("b", "str"); s.setAttribute("c", true);
    s.end();
  });
  bench("startSpan + end (JS tape)", () => { const s = new Span("op", null); s.end(); });
  bench("performance.now()", () => now());
  bench("2x now + alloc", () => { const s = { a: now(), b: 0 }; s.b = now(); return s; });
});
await run();
