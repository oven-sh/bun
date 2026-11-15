const out: string[] = [];
const v8 = new Uint8Array(2), v32 = new Uint32Array(2), vi = new Int32Array(2), vc = new Uint8ClampedArray(2), vf = new Float64Array(2), v16 = new Int16Array(2);
let list: number[] = [];
const raw = [0, 1, 2, -1, 127, 128, 255, 256, 32767, 65535, 2147483647, -2147483648, 4294967295, 4294967294, 3000000000, 7];
const places = [0, 3, 10, 12, 15, 16, -1, 40];
let hash = 0; let first = "";
function note(v: any): void { const t = Object.is(v, -0) ? "-0" : String(v); if (first.length < 60) first += t + ","; for (let q = 0; q < t.length; q++) hash = (Math.imul(hash, 31) + t.charCodeAt(q)) | 0; }
function end(name: string): void { out.push(name + " " + hash + " " + first); hash = 0; first = ""; list = []; }
const a = new Uint32Array(16), b = new Uint32Array(16), c = new Int32Array(16);
for (let q = 0; q < 16; q++) { a[q] = raw[q]!; b[q] = raw[(q * 5 + 3) % 16]!; c[q] = raw[(q * 7 + 1) % 16]!; }
function f0_or(i: number, j: number, k: number, x: number, y?: number): any { return (a[i]! + b[j]!) | 0; }
function f0_and(i: number, j: number, k: number, x: number, y?: number): any { return (a[i]! + b[j]!) & 255; }
function f0_not(i: number, j: number, k: number, x: number, y?: number): any { return ~(a[i]! + b[j]!); }
function f0_number(i: number, j: number, k: number, x: number, y?: number): any { return a[i]! + b[j]!; }
function f0_truth(i: number, j: number, k: number, x: number, y?: number): any { return (a[i]! + b[j]!) ? 1 : 2; }
function f0_text(i: number, j: number, k: number, x: number, y?: number): any { return `${a[i]! + b[j]!}`; }
function f0_u32(i: number, j: number, k: number, x: number, y?: number): any { return (v32[0] = a[i]! + b[j]!, v32[0]); }
function f0_clamped(i: number, j: number, k: number, x: number, y?: number): any { return (vc[0] = a[i]! + b[j]!, vc[0]); }
function f0_i16(i: number, j: number, k: number, x: number, y?: number): any { return (v16[0] = a[i]! + b[j]!, v16[0]); }
function f0_list(i: number, j: number, k: number, x: number, y?: number): any { return (list.push(a[i]! + b[j]!), list[list.length - 1]); }
function f3_unsigned(i: number, j: number, k: number, x: number, y?: number): any { return (a[i]! + (b[j]! - c[k]!)) >>> 0; }
function f3_shift(i: number, j: number, k: number, x: number, y?: number): any { return (a[i]! + (b[j]! - c[k]!)) << 3; }
function f3_xor(i: number, j: number, k: number, x: number, y?: number): any { return (a[i]! + (b[j]! - c[k]!)) ^ 0x55; }
function f3_less(i: number, j: number, k: number, x: number, y?: number): any { return (a[i]! + (b[j]! - c[k]!)) < 3; }
function f3_equal(i: number, j: number, k: number, x: number, y?: number): any { return (a[i]! + (b[j]! - c[k]!)) === 4; }
function f3_u8(i: number, j: number, k: number, x: number, y?: number): any { return (v8[0] = a[i]! + (b[j]! - c[k]!), v8[0]); }
function f3_i32(i: number, j: number, k: number, x: number, y?: number): any { return (vi[0] = a[i]! + (b[j]! - c[k]!), vi[0]); }
function f3_f64(i: number, j: number, k: number, x: number, y?: number): any { return (vf[0] = a[i]! + (b[j]! - c[k]!), vf[0]); }
function f3_add(i: number, j: number, k: number, x: number, y?: number): any { return v32[1] = v32[1]! + (a[i]! + (b[j]! - c[k]!)); }
function f3_negated(i: number, j: number, k: number, x: number, y?: number): any { return Object.is(-(a[i]! + (b[j]! - c[k]!)), -0); }
function f6_or(i: number, j: number, k: number, x: number, y?: number): any { return (1 - a[i]!) | 0; }
function f6_and(i: number, j: number, k: number, x: number, y?: number): any { return (1 - a[i]!) & 255; }
function f6_not(i: number, j: number, k: number, x: number, y?: number): any { return ~(1 - a[i]!); }
function f6_number(i: number, j: number, k: number, x: number, y?: number): any { return 1 - a[i]!; }
function f6_truth(i: number, j: number, k: number, x: number, y?: number): any { return (1 - a[i]!) ? 1 : 2; }
function f6_text(i: number, j: number, k: number, x: number, y?: number): any { return `${1 - a[i]!}`; }
function f6_u32(i: number, j: number, k: number, x: number, y?: number): any { return (v32[0] = 1 - a[i]!, v32[0]); }
function f6_clamped(i: number, j: number, k: number, x: number, y?: number): any { return (vc[0] = 1 - a[i]!, vc[0]); }
function f6_i16(i: number, j: number, k: number, x: number, y?: number): any { return (v16[0] = 1 - a[i]!, v16[0]); }
function f6_list(i: number, j: number, k: number, x: number, y?: number): any { return (list.push(1 - a[i]!), list[list.length - 1]); }
function f9_unsigned(i: number, j: number, k: number, x: number, y?: number): any { return (-a[i]!) >>> 0; }
function f9_shift(i: number, j: number, k: number, x: number, y?: number): any { return (-a[i]!) << 3; }
function f9_xor(i: number, j: number, k: number, x: number, y?: number): any { return (-a[i]!) ^ 0x55; }
function f9_less(i: number, j: number, k: number, x: number, y?: number): any { return (-a[i]!) < 3; }
function f9_equal(i: number, j: number, k: number, x: number, y?: number): any { return (-a[i]!) === 4; }
function f9_u8(i: number, j: number, k: number, x: number, y?: number): any { return (v8[0] = -a[i]!, v8[0]); }
function f9_i32(i: number, j: number, k: number, x: number, y?: number): any { return (vi[0] = -a[i]!, vi[0]); }
function f9_f64(i: number, j: number, k: number, x: number, y?: number): any { return (vf[0] = -a[i]!, vf[0]); }
function f9_add(i: number, j: number, k: number, x: number, y?: number): any { return v32[1] = v32[1]! + (-a[i]!); }
function f9_negated(i: number, j: number, k: number, x: number, y?: number): any { return Object.is(-(-a[i]!), -0); }
function f12_or(i: number, j: number, k: number, x: number, y?: number): any { return (a[i]! + a[i]!) | 0; }
function f12_and(i: number, j: number, k: number, x: number, y?: number): any { return (a[i]! + a[i]!) & 255; }
function f12_not(i: number, j: number, k: number, x: number, y?: number): any { return ~(a[i]! + a[i]!); }
function f12_number(i: number, j: number, k: number, x: number, y?: number): any { return a[i]! + a[i]!; }
function f12_truth(i: number, j: number, k: number, x: number, y?: number): any { return (a[i]! + a[i]!) ? 1 : 2; }
function f12_text(i: number, j: number, k: number, x: number, y?: number): any { return `${a[i]! + a[i]!}`; }
function f12_u32(i: number, j: number, k: number, x: number, y?: number): any { return (v32[0] = a[i]! + a[i]!, v32[0]); }
function f12_clamped(i: number, j: number, k: number, x: number, y?: number): any { return (vc[0] = a[i]! + a[i]!, vc[0]); }
function f12_i16(i: number, j: number, k: number, x: number, y?: number): any { return (v16[0] = a[i]! + a[i]!, v16[0]); }
function f12_list(i: number, j: number, k: number, x: number, y?: number): any { return (list.push(a[i]! + a[i]!), list[list.length - 1]); }
function f15_unsigned(i: number, j: number, k: number, x: number, y?: number): any { return (a[i]! + 0.5) >>> 0; }
function f15_shift(i: number, j: number, k: number, x: number, y?: number): any { return (a[i]! + 0.5) << 3; }
function f15_xor(i: number, j: number, k: number, x: number, y?: number): any { return (a[i]! + 0.5) ^ 0x55; }
function f15_less(i: number, j: number, k: number, x: number, y?: number): any { return (a[i]! + 0.5) < 3; }
function f15_equal(i: number, j: number, k: number, x: number, y?: number): any { return (a[i]! + 0.5) === 4; }
function f15_u8(i: number, j: number, k: number, x: number, y?: number): any { return (v8[0] = a[i]! + 0.5, v8[0]); }
function f15_i32(i: number, j: number, k: number, x: number, y?: number): any { return (vi[0] = a[i]! + 0.5, vi[0]); }
function f15_f64(i: number, j: number, k: number, x: number, y?: number): any { return (vf[0] = a[i]! + 0.5, vf[0]); }
function f15_add(i: number, j: number, k: number, x: number, y?: number): any { return v32[1] = v32[1]! + (a[i]! + 0.5); }
function f15_negated(i: number, j: number, k: number, x: number, y?: number): any { return Object.is(-(a[i]! + 0.5), -0); }
function f18_or(i: number, j: number, k: number, x: number, y?: number): any { return (y! - a[i]!) | 0; }
function f18_and(i: number, j: number, k: number, x: number, y?: number): any { return (y! - a[i]!) & 255; }
function f18_not(i: number, j: number, k: number, x: number, y?: number): any { return ~(y! - a[i]!); }
function f18_number(i: number, j: number, k: number, x: number, y?: number): any { return y! - a[i]!; }
function f18_truth(i: number, j: number, k: number, x: number, y?: number): any { return (y! - a[i]!) ? 1 : 2; }
function f18_text(i: number, j: number, k: number, x: number, y?: number): any { return `${y! - a[i]!}`; }
function f18_u32(i: number, j: number, k: number, x: number, y?: number): any { return (v32[0] = y! - a[i]!, v32[0]); }
function f18_clamped(i: number, j: number, k: number, x: number, y?: number): any { return (vc[0] = y! - a[i]!, vc[0]); }
function f18_i16(i: number, j: number, k: number, x: number, y?: number): any { return (v16[0] = y! - a[i]!, v16[0]); }
function f18_list(i: number, j: number, k: number, x: number, y?: number): any { return (list.push(y! - a[i]!), list[list.length - 1]); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f0_or(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f0_or(i + 0.5, j, 99, 4294967295, j)); } end("f0_or");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note((a[i]! + b[j]!) | 0); } end("l0or"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f0_and(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f0_and(i + 0.5, j, 99, 4294967295, j)); } end("f0_and");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f0_not(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f0_not(i + 0.5, j, 99, 4294967295, j)); } end("f0_not");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note(~(a[i]! + b[j]!)); } end("l0not"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f0_number(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f0_number(i + 0.5, j, 99, 4294967295, j)); } end("f0_number");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f0_truth(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f0_truth(i + 0.5, j, 99, 4294967295, j)); } end("f0_truth");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note((a[i]! + b[j]!) ? 1 : 2); } end("l0truth"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f0_text(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f0_text(i + 0.5, j, 99, 4294967295, j)); } end("f0_text");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f0_u32(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f0_u32(i + 0.5, j, 99, 4294967295, j)); } end("f0_u32");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note((v32[0] = a[i]! + b[j]!, v32[0])); } end("l0u32"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f0_clamped(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f0_clamped(i + 0.5, j, 99, 4294967295, j)); } end("f0_clamped");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f0_i16(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f0_i16(i + 0.5, j, 99, 4294967295, j)); } end("f0_i16");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note((v16[0] = a[i]! + b[j]!, v16[0])); } end("l0i16"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f0_list(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f0_list(i + 0.5, j, 99, 4294967295, j)); } end("f0_list");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f3_unsigned(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f3_unsigned(i + 0.5, j, 99, 4294967295, j)); } end("f3_unsigned");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note((a[i]! + (b[j]! - c[k]!)) >>> 0); } end("l3unsigned"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f3_shift(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f3_shift(i + 0.5, j, 99, 4294967295, j)); } end("f3_shift");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f3_xor(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f3_xor(i + 0.5, j, 99, 4294967295, j)); } end("f3_xor");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note((a[i]! + (b[j]! - c[k]!)) ^ 0x55); } end("l3xor"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f3_less(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f3_less(i + 0.5, j, 99, 4294967295, j)); } end("f3_less");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f3_equal(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f3_equal(i + 0.5, j, 99, 4294967295, j)); } end("f3_equal");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note((a[i]! + (b[j]! - c[k]!)) === 4); } end("l3equal"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f3_u8(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f3_u8(i + 0.5, j, 99, 4294967295, j)); } end("f3_u8");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f3_i32(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f3_i32(i + 0.5, j, 99, 4294967295, j)); } end("f3_i32");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note((vi[0] = a[i]! + (b[j]! - c[k]!), vi[0])); } end("l3i32"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f3_f64(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f3_f64(i + 0.5, j, 99, 4294967295, j)); } end("f3_f64");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f3_add(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f3_add(i + 0.5, j, 99, 4294967295, j)); } end("f3_add");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note(v32[1] = v32[1]! + (a[i]! + (b[j]! - c[k]!))); } end("l3add"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f3_negated(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f3_negated(i + 0.5, j, 99, 4294967295, j)); } end("f3_negated");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f6_or(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f6_or(i + 0.5, j, 99, 4294967295, j)); } end("f6_or");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f6_and(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f6_and(i + 0.5, j, 99, 4294967295, j)); } end("f6_and");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note((1 - a[i]!) & 255); } end("l6and"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f6_not(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f6_not(i + 0.5, j, 99, 4294967295, j)); } end("f6_not");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f6_number(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f6_number(i + 0.5, j, 99, 4294967295, j)); } end("f6_number");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note(1 - a[i]!); } end("l6number"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f6_truth(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f6_truth(i + 0.5, j, 99, 4294967295, j)); } end("f6_truth");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f6_text(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f6_text(i + 0.5, j, 99, 4294967295, j)); } end("f6_text");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note(`${1 - a[i]!}`); } end("l6text"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f6_u32(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f6_u32(i + 0.5, j, 99, 4294967295, j)); } end("f6_u32");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f6_clamped(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f6_clamped(i + 0.5, j, 99, 4294967295, j)); } end("f6_clamped");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note((vc[0] = 1 - a[i]!, vc[0])); } end("l6clamped"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f6_i16(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f6_i16(i + 0.5, j, 99, 4294967295, j)); } end("f6_i16");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f6_list(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f6_list(i + 0.5, j, 99, 4294967295, j)); } end("f6_list");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note((list.push(1 - a[i]!), list[list.length - 1])); } end("l6list"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f9_unsigned(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f9_unsigned(i + 0.5, j, 99, 4294967295, j)); } end("f9_unsigned");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f9_shift(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f9_shift(i + 0.5, j, 99, 4294967295, j)); } end("f9_shift");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note((-a[i]!) << 3); } end("l9shift"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f9_xor(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f9_xor(i + 0.5, j, 99, 4294967295, j)); } end("f9_xor");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f9_less(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f9_less(i + 0.5, j, 99, 4294967295, j)); } end("f9_less");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note((-a[i]!) < 3); } end("l9less"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f9_equal(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f9_equal(i + 0.5, j, 99, 4294967295, j)); } end("f9_equal");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f9_u8(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f9_u8(i + 0.5, j, 99, 4294967295, j)); } end("f9_u8");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note((v8[0] = -a[i]!, v8[0])); } end("l9u8"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f9_i32(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f9_i32(i + 0.5, j, 99, 4294967295, j)); } end("f9_i32");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f9_f64(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f9_f64(i + 0.5, j, 99, 4294967295, j)); } end("f9_f64");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note((vf[0] = -a[i]!, vf[0])); } end("l9f64"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f9_add(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f9_add(i + 0.5, j, 99, 4294967295, j)); } end("f9_add");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f9_negated(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f9_negated(i + 0.5, j, 99, 4294967295, j)); } end("f9_negated");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note(Object.is(-(-a[i]!), -0)); } end("l9negated"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f12_or(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f12_or(i + 0.5, j, 99, 4294967295, j)); } end("f12_or");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note((a[i]! + a[i]!) | 0); } end("l12or"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f12_and(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f12_and(i + 0.5, j, 99, 4294967295, j)); } end("f12_and");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f12_not(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f12_not(i + 0.5, j, 99, 4294967295, j)); } end("f12_not");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note(~(a[i]! + a[i]!)); } end("l12not"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f12_number(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f12_number(i + 0.5, j, 99, 4294967295, j)); } end("f12_number");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f12_truth(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f12_truth(i + 0.5, j, 99, 4294967295, j)); } end("f12_truth");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note((a[i]! + a[i]!) ? 1 : 2); } end("l12truth"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f12_text(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f12_text(i + 0.5, j, 99, 4294967295, j)); } end("f12_text");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f12_u32(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f12_u32(i + 0.5, j, 99, 4294967295, j)); } end("f12_u32");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note((v32[0] = a[i]! + a[i]!, v32[0])); } end("l12u32"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f12_clamped(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f12_clamped(i + 0.5, j, 99, 4294967295, j)); } end("f12_clamped");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f12_i16(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f12_i16(i + 0.5, j, 99, 4294967295, j)); } end("f12_i16");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note((v16[0] = a[i]! + a[i]!, v16[0])); } end("l12i16"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f12_list(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f12_list(i + 0.5, j, 99, 4294967295, j)); } end("f12_list");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f15_unsigned(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f15_unsigned(i + 0.5, j, 99, 4294967295, j)); } end("f15_unsigned");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note((a[i]! + 0.5) >>> 0); } end("l15unsigned"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f15_shift(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f15_shift(i + 0.5, j, 99, 4294967295, j)); } end("f15_shift");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f15_xor(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f15_xor(i + 0.5, j, 99, 4294967295, j)); } end("f15_xor");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note((a[i]! + 0.5) ^ 0x55); } end("l15xor"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f15_less(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f15_less(i + 0.5, j, 99, 4294967295, j)); } end("f15_less");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f15_equal(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f15_equal(i + 0.5, j, 99, 4294967295, j)); } end("f15_equal");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note((a[i]! + 0.5) === 4); } end("l15equal"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f15_u8(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f15_u8(i + 0.5, j, 99, 4294967295, j)); } end("f15_u8");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f15_i32(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f15_i32(i + 0.5, j, 99, 4294967295, j)); } end("f15_i32");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note((vi[0] = a[i]! + 0.5, vi[0])); } end("l15i32"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f15_f64(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f15_f64(i + 0.5, j, 99, 4294967295, j)); } end("f15_f64");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f15_add(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f15_add(i + 0.5, j, 99, 4294967295, j)); } end("f15_add");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note(v32[1] = v32[1]! + (a[i]! + 0.5)); } end("l15add"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f15_negated(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f15_negated(i + 0.5, j, 99, 4294967295, j)); } end("f15_negated");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f18_or(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f18_or(i + 0.5, j, 99, 4294967295, j)); } end("f18_or");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f18_and(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f18_and(i + 0.5, j, 99, 4294967295, j)); } end("f18_and");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note((y! - a[i]!) & 255); } end("l18and"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f18_not(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f18_not(i + 0.5, j, 99, 4294967295, j)); } end("f18_not");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f18_number(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f18_number(i + 0.5, j, 99, 4294967295, j)); } end("f18_number");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note(y! - a[i]!); } end("l18number"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f18_truth(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f18_truth(i + 0.5, j, 99, 4294967295, j)); } end("f18_truth");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f18_text(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f18_text(i + 0.5, j, 99, 4294967295, j)); } end("f18_text");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note(`${y! - a[i]!}`); } end("l18text"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f18_u32(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f18_u32(i + 0.5, j, 99, 4294967295, j)); } end("f18_u32");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f18_clamped(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f18_clamped(i + 0.5, j, 99, 4294967295, j)); } end("f18_clamped");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note((vc[0] = y! - a[i]!, vc[0])); } end("l18clamped"); }
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f18_i16(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f18_i16(i + 0.5, j, 99, 4294967295, j)); } end("f18_i16");
for (const i of places) for (const j of [0, 5, 14, 17]) { note(f18_list(i, j, (i + j) & 15, i * 1000, i & 1 ? undefined : j)); if (j === 5) note(f18_list(i + 0.5, j, 99, 4294967295, j)); } end("f18_list");
{ const x = 11, y: number | undefined = 5; for (let i = 0; i < 18; i++) { const j = (i * 3) % 19, k = i ^ 1; note((list.push(y! - a[i]!), list[list.length - 1])); } end("l18list"); }
console.log(out.join("\n"));
