// Typed arrays whose buffer is transferred or resized while a loop goes over them.
const log = (...a) => console.log(a.map(String).join(" "));
{ const ta = new Uint8Array(16).fill(1); let s = 0; const n = ta.length; for (let i = 0; i < n; i++) { if (i === 4) structuredClone(ta.buffer, { transfer: [ta.buffer] }); s += ta[i] === undefined ? 100 : ta[i]; } log(1, s, ta.length, ta.byteLength, ta.byteOffset); }
{ const ta = new Float64Array(8).fill(1.5); function gone() { ta.buffer.transfer(); } let s = 0; for (let i = 0; i < ta.length; i++) { s += ta[i]; if (i === 2) gone(); } log(2, s, ta.length); }
{ const buf = new ArrayBuffer(16, { maxByteLength: 32 }); const ta = new Uint8Array(buf); ta.fill(2); let s = 0; const n = ta.length; for (let i = 0; i < n; i++) { if (i === 3) buf.resize(4); s += ta[i] ?? 50; } log(3, s, ta.length); buf.resize(32); log(3, ta.length, ta[31], ta[3]); }
{ const buf = new ArrayBuffer(16, { maxByteLength: 32 }); const ta = new Uint8Array(buf, 8, 4); log(4, ta.length); buf.resize(10); log(4, ta.length, ta[0], ta.byteOffset); buf.resize(16); log(4, ta.length); }
{ const ta = new Int32Array(8); ta[2] = { valueOf() { ta.buffer.transfer(); return 7; } }; log(5, ta.length, ta[2]); }
{ const ta = new Int32Array(8); const idx = { valueOf() { ta.buffer.transfer(); return 2; } }; ta[idx] = 5; log(6, ta.length, ta[2], ta[idx]); }

{ const ta = new Uint8Array(8).fill(3); try { for (const x of ta) { ta.buffer.transfer(); } log(8, "no throw"); } catch (e) { log(8, e.constructor.name); } }
{ const ta = new Uint8Array(8).fill(3); try { log(9, ta.map((x, i) => { if (i === 1) ta.buffer.transfer(); return x; }).join()); } catch (e) { log(9, e.constructor.name); } }
{ const ta = new Uint8Array(8); const dv = new DataView(ta.buffer); ta.buffer.transfer(); try { dv.getUint8(0); } catch (e) { log(10, e.constructor.name); } try { log(10, dv.byteLength); } catch (e) { log(10, e.constructor.name); } }
{ class H { constructor() { this.bytes = new Uint8Array(32).fill(9); this.n = this.bytes.length; } sum() { let s = 0; for (let i = 0; i < this.n; i++) s += this.bytes[i] | 0; return s; } } const h = new H(); log(11, h.sum()); h.bytes.buffer.transfer(); log(11, h.sum(), h.bytes.length); }
{ const ta = new Uint8Array(1 << 20).fill(1); const ch = new MessageChannel(); ch.port1.postMessage(ta.buffer, [ta.buffer]); let s = 0; for (let i = 0; i < 10; i++) s += ta[i] ?? 5; log(12, s, ta.length); ch.port1.close(); ch.port2.close(); }
{ const sab = new SharedArrayBuffer(8, { maxByteLength: 64 }); const ta = new Uint8Array(sab); const n = ta.length; sab.grow(64); log(13, n, ta.length, ta[63]); }
{ const b = Buffer.alloc(16, 1); const n = b.length; b.buffer.transfer?.(); let s = 0; for (let i = 0; i < n; i++) s += b[i] ?? 3; log(14, s, b.length); try { log(14, b.readUInt8(0)); } catch (e) { log(14, e.constructor.name); } }
{ const ta = new Uint8Array(8).fill(1); const sub = ta.subarray(2, 6); ta.buffer.transfer(); log(15, sub.length, sub[0], sub.byteOffset); }
{ const ta = new Uint16Array(4); ta[10] = 5; ta[-1] = 5; ta["1.5"] = 5; ta["x"] = 5; log(16, ta[10], ta[-1], ta["1.5"], ta.x, Object.keys(ta).join(), 10 in ta, "-0" in ta); }
{ const ta = new Uint8ClampedArray(3); ta[0] = 300; ta[1] = -5; ta[2] = 1.5; const i8 = new Int8Array(2); i8[0] = 200; i8[1] = NaN; const f = new Float32Array(1); f[0] = 0.1; const u = new Uint32Array(1); u[0] = -1; log(17, ta.join(), i8.join(), f[0], u[0], u[0] + 1); const bi = new BigInt64Array(1); try { bi[0] = 1; } catch (e) { log(17, e.constructor.name); } bi[0] = 2n ** 63n; log(17, bi[0]); }
