// Twenty shapes of loop keep counters and sums that start just below 2 ** 31 and 2 ** 53, over 18 lengths and 16 first values. A number that goes up by one stays at 2 ** 53, however long the loop
// runs on: a sum beside it goes on past 2 ** 31.
const show = v => typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : typeof v === "bigint" ? v + "n" : typeof v === "string" ? JSON.stringify(v) : String(v);
const LENGTHS = [0, 1, 2, 7, 8, 9, 15, 16, 17, 23, 24, 25, 31, 32, 33, 64, 65, 1000];
const STARTS = [-1, 0, 1, -5, -0, 0.5, NaN, Infinity, -Infinity, 2147483639, 2147483647, -2147483640, 4294967287, 9007199254740983, 9007199254740991, 100];
const STEPS = [1, 2, -1, 3, 0.5, NaN, -0, 2147483647, 1e15, 7, 0, -2147483648];
const PLACES = [-1, 0, 3, 7, 8, 9, 11, 12, 15, 16, 20, 500];
const STEP = 3;
function value(pattern, i) {
  switch (pattern) {
    case 0: return 0;
    case 1: return i % 97;
    case 2: return 96 - (i % 97);
    case 3: return (i * 37 + 11) % 97;
    case 4: return 5;
    default: return ((i * 53 + 29) % 97) - 48;
  }
}
function attempt(run) { try { return run(); } catch (error) { return "threw " + error.name; } }
function make_Uint32Array(n, pattern, place) { const v = new Uint32Array(n); for (let i = 0; i < n; i++) v[i] = i === place ? 99 : value(pattern, i); return v; }
function make_Int32Array(n, pattern, place) { const v = new Int32Array(n); for (let i = 0; i < n; i++) v[i] = i === place ? 99 : value(pattern, i); return v; }
function make_Float64Array(n, pattern, place) { const v = new Float64Array(n); for (let i = 0; i < n; i++) v[i] = i === place ? 99 : value(pattern, i); return v; }
function make_Uint8Array(n, pattern, place) { const v = new Uint8Array(n); for (let i = 0; i < n; i++) v[i] = i === place ? 99 : value(pattern, i); return v; }
function make_string(n, pattern, place) { let v = ""; for (let i = 0; i < n; i++) v += String.fromCharCode(i === place ? 99 : (value(pattern, i) & 127) + 100); return v; }
function make_Float32Array(n, pattern, place) { const v = new Float32Array(n); for (let i = 0; i < n; i++) v[i] = i === place ? 99 : value(pattern, i); return v; }
function make_holes(n, pattern, place) { const v = []; for (let i = 0; i < n; i++) v.push(i === place ? 99 : value(pattern, i)); for (let i = 3; i < n; i += 5) if (i !== place) delete v[i]; return v; }
function make_resizable(n, pattern, place) { const v = new Int32Array(new ArrayBuffer(n * 4, { maxByteLength: n * 8 + 64 })); for (let i = 0; i < n; i++) v[i] = i === place ? 99 : value(pattern, i); return v; }
function make_Int8Array(n, pattern, place) { const v = new Int8Array(n); for (let i = 0; i < n; i++) v[i] = i === place ? 99 : value(pattern, i); return v; }
function make_Uint16Array(n, pattern, place) { const v = new Uint16Array(n); for (let i = 0; i < n; i++) v[i] = i === place ? 99 : value(pattern, i); return v; }
function make_BigInt64Array(n, pattern, place) { const v = new BigInt64Array(n); for (let i = 0; i < n; i++) v[i] = BigInt(i === place ? 99 : value(pattern, i)); return v; }
function make_doubles(n, pattern, place) { const v = []; for (let i = 0; i < n; i++) v.push(i === place ? 99 : value(pattern, i) + 0.25); return v; }
function make_set(n, pattern, place) { const v = new Set(); for (let i = 0; i < n; i++) v.add(i === place ? 99 : 100 + ((i * 389 + 7 + pattern) % 1009)); return v; }
function f0(n, pattern, place, start, c, b, o) {
const v = make_Uint32Array(n, pattern, place);
let k = start, j = 0, s = 0, g = 0, other = start, last = start;
let t = 0, m = 0, n2 = 0, fin = 0, idx = -1, once = true, thrown = "";
const seen = [], out = [0, 0, 0, 0, 0, 0, 0, 0];
for (const x of v) {
idx++;
k = k + c;
j -= o.f;
if (k > 2147483646) n2++;
}
return [k, j, s, g, other, last, t, m, n2, fin, thrown].map(show).join() + "|" + seen.map(show).join() + "|" + out.map(show).join();
}
function f1(v, start, c, b, o) {
let k = -0, j = start, s = 0, g = 0, other = start, last = start;
let t = 0, m = 0, n2 = 0, fin = 0, idx = -1, once = true, thrown = "";
const seen = [], out = [0, 0, 0, 0, 0, 0, 0, 0];
{ let i = 0; while (i < v.length) {
const x = v[i]; i++;
idx++;
if (once && x === 99) { once = false; n2 += 100; }
k = k + 0.5;
t += out[k & 7];
} }
return [k, j, s, g, other, last, t, m, n2, fin, thrown].map(show).join() + "|" + seen.map(show).join() + "|" + out.map(show).join();
}
function f2(n, pattern, place, start, c, b, o) {
const v = make_Float64Array(n, pattern, place);
let k = start, j = start, s = 2147483600, g = 50, other = start, last = start;
let t = 0, m = 0, n2 = 0, fin = 0, idx = -1, once = true, thrown = "";
const seen = [], out = [0, 0, 0, 0, 0, 0, 0, 0];
try {
{ let i = 0; while (i < v.length) {
const x = v[i]; i++;
idx++;
try { if (idx === b) break; } finally { last = k; fin += 2; }
k = k + 3;
if (idx === b) throw { at: show(k) + "/" + show(j) };
other = x > g ? k : other;
s += 1;
} }
} catch (error) { thrown = error && error.at !== undefined ? error.at : error.name; }
return [k, j, s, g, other, last, t, m, n2, fin, thrown].map(show).join() + "|" + seen.map(show).join() + "|" + out.map(show).join();
}
function f3(n, pattern, place, start, c, b, o) {
const v = make_Uint8Array(n, pattern, place);
let k = 2147483639, j = -2147483640, s = start, g = 0, other = start, last = start;
let t = 0, m = 0, n2 = 0, fin = 0, idx = -1, once = true, thrown = "";
const seen = [], out = [0, 0, 0, 0, 0, 0, 0, 0];
{ let i = 0; while (i < v.length) {
const x = v[i]; i++;
k += 0;
++s;
last = k;
j -= o.f;
} }
return [k, j, s, g, other, last, t, m, n2, fin, thrown].map(show).join() + "|" + seen.map(show).join() + "|" + out.map(show).join();
}
function f4(v, start, c, b, o) {
let k = 2147483639, j = start, s = 0.5, g = -Infinity, other = start, last = start;
let t = 0, m = 0, n2 = 0, fin = 0, idx = -1, once = true, thrown = "";
const seen = [], out = [0, 0, 0, 0, 0, 0, 0, 0];
for (let again = 0; again < 3; again++) {
{ let i = 0; if (v.length > 0) do {
const x = v[i] ?? ""; i++;
idx++;
k = (k + 5) | 0;
if (x.charCodeAt(0) < g) { g = x.charCodeAt(0); other = k; }
j += 7;
if (i === b) { other = k; break; }
} while (i < v.length); }
}
return [k, j, s, g, other, last, t, m, n2, fin, thrown].map(show).join() + "|" + seen.map(show).join() + "|" + out.map(show).join();
}
function f5(v, start, c, b, o) {
let k = 9007199254740983, j = start | 0, s = 2147483600, g = start, other = start, last = start;
let t = 0, m = 0, n2 = 0, fin = 0, idx = -1, once = true, thrown = "";
const seen = [], out = [0, 0, 0, 0, 0, 0, 0, 0];
const bump = () => { k += 1; };
for (const x of v) {
idx++;
s += STEP;
bump();
for (let q = 0; q < 3; q++) { t += k; m++; }
}
return [k, j, s, g, other, last, t, m, n2, fin, thrown].map(show).join() + "|" + seen.map(show).join() + "|" + out.map(show).join();
}
function f6(n, pattern, place, start, c, b, o) {
const v = make_Uint32Array(n, pattern, place);
let k = 0, j = -0, s = start, g = -Infinity, other = start, last = start;
let t = 0, m = 0, n2 = 0, fin = 0, idx = -1, once = true, thrown = "";
const seen = [], out = [0, 0, 0, 0, 0, 0, 0, 0];
const read = () => k;
const bump = () => { k += 1; };
const box = { get k() { return k; } };
for (let i = 0; i < v.length; i += 2) {
const x = v[i];
if (x > g) { g = x; other = box.k; }
bump();
if (x > g) { g = x; other = read(); }
s -= 16;
}
return [k, j, s, g, other, last, t, m, n2, fin, thrown].map(show).join() + "|" + seen.map(show).join() + "|" + out.map(show).join();
}
function f7(n, pattern, place, start, c, b, o) {
const v = make_holes(n, pattern, place);
let k = start, j = 0, s = 0, g = start, other = start, last = start;
let t = 0, m = 0, n2 = 0, fin = 0, idx = -1, once = true, thrown = "";
const seen = [], out = [0, 0, 0, 0, 0, 0, 0, 0];
{ let i = 0; if (v.length > 0) do {
const x = v[i]; i++;
idx++;
k--;
t += out[k & 7];
} while (i < v.length); }
return [k, j, s, g, other, last, t, m, n2, fin, thrown].map(show).join() + "|" + seen.map(show).join() + "|" + out.map(show).join();
}
function f8(v, start, c, b, o) {
let k = -2147483640, j = -2147483640, s = 2147483600, g = -Infinity, other = start, last = start;
let t = 0, m = 0, n2 = 0, fin = 0, idx = -1, once = true, thrown = "";
const seen = [], out = [0, 0, 0, 0, 0, 0, 0, 0];
for (let i = 0; i < v.length; i++) {
const x = v[i];
idx++;
if (seen.length < 12 && x > 80) seen.push(k);
k = k + o.f;
s += 3;
}
return [k, j, s, g, other, last, t, m, n2, fin, thrown].map(show).join() + "|" + seen.map(show).join() + "|" + out.map(show).join();
}
function f9(v, start, c, b, o) {
let k = 4294967287, j = -1, s = 0, g = -Infinity, other = start, last = start;
let t = 0, m = 0, n2 = 0, fin = 0, idx = -1, once = true, thrown = "";
const seen = [], out = [0, 0, 0, 0, 0, 0, 0, 0];
for (let i = 0; i < v.length; i += 2) {
const x = v[i];
idx++;
k += o.f;
if (x > 40) other = k; else last = k;
j -= 16;
}
return [k, j, s, g, other, last, t, m, n2, fin, thrown].map(show).join() + "|" + seen.map(show).join() + "|" + out.map(show).join();
}
function f10(v, start, c, b, o) {
let k = start | 0, j = start, s = start, g = start, other = start, last = start;
let t = 0, m = 0, n2 = 0, fin = 0, idx = -1, once = true, thrown = "";
const seen = [], out = [0, 0, 0, 0, 0, 0, 0, 0];
try {
for (const x of v) {
s += 16;
k -= 1;
last = k;
if (x === 99) throw { at: show(k) + "/" + show(j) };
}
} catch (error) { thrown = error && error.at !== undefined ? error.at : error.name; }
return [k, j, s, g, other, last, t, m, n2, fin, thrown].map(show).join() + "|" + seen.map(show).join() + "|" + out.map(show).join();
}
function f11(n, pattern, place, start, c, b, o) {
const v = make_Uint16Array(n, pattern, place);
let k = 1, j = start, s = start, g = -Infinity, other = start, last = start;
let t = 0, m = 0, n2 = 0, fin = 0, idx = -1, once = true, thrown = "";
const seen = [], out = [0, 0, 0, 0, 0, 0, 0, 0];
let kept = () => -7;
for (let i = 0; i < v.length; i++) {
const x = v[i];
k = k + 1;
for (let q = 0; q < 3; q++) { t += k; m++; }
if (x > g) { g = x; kept = () => k; }
}
return [k, j, s, g, other, last, t, m, n2, fin, thrown, kept()].map(show).join() + "|" + seen.map(show).join() + "|" + out.map(show).join();
}
function f12(n, pattern, place, start, c, b, o) {
const v = make_BigInt64Array(n, pattern, place);
let k = -2147483640, j = 1, s = 2147483600, g = start, other = start, last = start;
let t = 0, m = 0, n2 = 0, fin = 0, idx = -1, once = true, thrown = "";
const seen = [], out = [0, 0, 0, 0, 0, 0, 0, 0];
for (let i = v.length - 1; i >= 0; i--) {
const x = v[i] ?? 0n;
idx++;
k -= o.f;
j = (j + 7) >>> 0;
if (Number(x) === 99) return "ret " + [k, j, s, g, other, last].map(show).join();
}
return [k, j, s, g, other, last, t, m, n2, fin, thrown].map(show).join() + "|" + seen.map(show).join() + "|" + out.map(show).join();
}
function f13(v, start, c, b, o) {
let k = 1, j = 9007199254740983, s = 0.5, g = 50, other = start, last = start;
let t = 0, m = 0, n2 = 0, fin = 0, idx = -1, once = true, thrown = "";
const seen = [], out = [0, 0, 0, 0, 0, 0, 0, 0];
for (const x of v) {
idx++;
j -= 2;
k -= 2;
s += x;
}
return [k, j, s, g, other, last, t, m, n2, fin, thrown].map(show).join() + "|" + seen.map(show).join() + "|" + out.map(show).join();
}
function f14(n, pattern, place, start, c, b, o) {
const v = make_doubles(n, pattern, place);
let k = 4294967287, j = -0, s = start, g = -Infinity, other = start, last = start;
let t = 0, m = 0, n2 = 0, fin = 0, idx = -1, once = true, thrown = "";
const seen = [], out = [0, 0, 0, 0, 0, 0, 0, 0];
for (let i = 0; i < v.length; i += 2) {
const x = v[i];
if (i === b) return "ret " + [k, j, s, g, other, last].map(show).join();
if (seen.length < 12 && x > 80) seen.push(k);
if (i === b) return "ret " + [k, j, s, g, other, last].map(show).join();
k += 5;
}
return [k, j, s, g, other, last, t, m, n2, fin, thrown].map(show).join() + "|" + seen.map(show).join() + "|" + out.map(show).join();
}
function f15(v, start, c, b, o) {
let k = -0, j = start, s = 2147483600, g = -1, other = start, last = start;
let t = 0, m = 0, n2 = 0, fin = 0, idx = -1, once = true, thrown = "";
const seen = [], out = [0, 0, 0, 0, 0, 0, 0, 0];
const box = { get k() { return k; } };
{ let i = 0; if (v.length > 0) do {
const x = v[i]; i++;
j = 1 + j;
k = (k + 0) | 0;
if (x > g) { g = x; other = box.k; }
if (x > 60) out[i & 7] = k;
} while (i < v.length); }
return [k, j, s, g, other, last, t, m, n2, fin, thrown].map(show).join() + "|" + seen.map(show).join() + "|" + out.map(show).join();
}
function f16(n, pattern, place, start, c, b, o) {
const v = make_Uint32Array(n, pattern, place);
let k = -2147483640, j = -1, s = 0.5, g = 0, other = start, last = start;
let t = 0, m = 0, n2 = 0, fin = 0, idx = -1, once = true, thrown = "";
const seen = [], out = [0, 0, 0, 0, 0, 0, 0, 0];
try {
for (let i = v.length - 1; i >= 0; i--) {
const x = v[i];
idx++;
k = k + -3;
if (x < g) { g = x; other = k; }
try { if (x === 99) break; } finally { last = k; fin += 2; }
j = (j + 65536) | 0;
if (x === 99) throw { at: show(k) + "/" + show(j) };
}
} catch (error) { thrown = error && error.at !== undefined ? error.at : error.name; }
return [k, j, s, g, other, last, t, m, n2, fin, thrown].map(show).join() + "|" + seen.map(show).join() + "|" + out.map(show).join();
}
function f17(v, start, c, b, o) {
let k = -1, j = 9007199254740983, s = 0, g = 50, other = start, last = start;
let t = 0, m = 0, n2 = 0, fin = 0, idx = -1, once = true, thrown = "";
const seen = [], out = [0, 0, 0, 0, 0, 0, 0, 0];
for (let i = 0; i < v.length; i++) {
const x = v[i] ?? "";
idx++;
try { if (i === b) break; } finally { last = k; fin += 2; }
s += x.charCodeAt(0);
j -= 255;
s += 5;
k -= 2147483647;
}
return [k, j, s, g, other, last, t, m, n2, fin, thrown].map(show).join() + "|" + seen.map(show).join() + "|" + out.map(show).join();
}
function f18(v, start, c, b, o) {
let k = -0, j = start, s = 0, g = 0, other = start, last = start;
let t = 0, m = 0, n2 = 0, fin = 0, idx = -1, once = true, thrown = "";
const seen = [], out = [0, 0, 0, 0, 0, 0, 0, 0];
for (const x of v) {
k += 1;
j = (j + c) >>> 0;
if (x > g) other = k;
}
return [k, j, s, g, other, last, t, m, n2, fin, thrown].map(show).join() + "|" + seen.map(show).join() + "|" + out.map(show).join();
}
function f19(n, pattern, place, start, c, b, o) {
const v = make_Float64Array(n, pattern, place);
let k = -1, j = -2147483640, s = 0, g = start, other = start, last = start;
let t = 0, m = 0, n2 = 0, fin = 0, idx = -1, once = true, thrown = "";
const seen = [], out = [0, 0, 0, 0, 0, 0, 0, 0];
const bump = () => { k += 1; };
{ let i = 0; if (v.length > 0) do {
const x = v[i]; i++;
idx++;
j -= -3;
for (let q = 0; q < 3; q++) { t += k; m++; }
if (once && i === b) { once = false; n2 += 100; }
bump();
} while (i < v.length); }
return [k, j, s, g, other, last, t, m, n2, fin, thrown].map(show).join() + "|" + seen.map(show).join() + "|" + out.map(show).join();
}
const lines = [];
for (let a = 0; a < LENGTHS.length; a++) for (let z = 0; z < STARTS.length; z++) {
  const n = LENGTHS[a], start = STARTS[z];
  { const place = PLACES[(a * 5 + z * 3 + 0) % PLACES.length], c = STEPS[(a + z * 7 + 0) % STEPS.length], pattern = (a + z + 0) % 6, o = { f: STEPS[(a * 3 + z + 0) % STEPS.length], get g() { return 2; } };
    lines.push("f0 Uint32Array of | " + n + " " + show(start) + " " + place + " " + show(c) + " " + show(o.f) + " " + pattern + ": " + attempt(() => f0(n, pattern, place, start, c, place, o))); }
  { const place = PLACES[(a * 5 + z * 3 + 1) % PLACES.length], c = STEPS[(a + z * 7 + 1) % STEPS.length], pattern = (a + z + 1) % 6, o = { f: STEPS[(a * 3 + z + 1) % STEPS.length], get g() { return 2; } };
    lines.push("f1 Int32Array while | " + n + " " + show(start) + " " + place + " " + show(c) + " " + show(o.f) + " " + pattern + ": " + attempt(() => f1(make_Int32Array(n, pattern, place), start, c, place, o))); }
  { const place = PLACES[(a * 5 + z * 3 + 2) % PLACES.length], c = STEPS[(a + z * 7 + 2) % STEPS.length], pattern = (a + z + 2) % 6, o = { f: STEPS[(a * 3 + z + 2) % STEPS.length], get g() { return 2; } };
    lines.push("f2 Float64Array while | " + n + " " + show(start) + " " + place + " " + show(c) + " " + show(o.f) + " " + pattern + ": " + attempt(() => f2(n, pattern, place, start, c, place, o))); }
  { const place = PLACES[(a * 5 + z * 3 + 3) % PLACES.length], c = STEPS[(a + z * 7 + 3) % STEPS.length], pattern = (a + z + 3) % 6, o = { f: STEPS[(a * 3 + z + 3) % STEPS.length], get g() { return 2; } };
    lines.push("f3 Uint8Array while | " + n + " " + show(start) + " " + place + " " + show(c) + " " + show(o.f) + " " + pattern + ": " + attempt(() => f3(n, pattern, place, start, c, place, o))); }
  { const place = PLACES[(a * 5 + z * 3 + 4) % PLACES.length], c = STEPS[(a + z * 7 + 4) % STEPS.length], pattern = (a + z + 4) % 6, o = { f: STEPS[(a * 3 + z + 4) % STEPS.length], get g() { return 2; } };
    lines.push("f4 string do | " + n + " " + show(start) + " " + place + " " + show(c) + " " + show(o.f) + " " + pattern + ": " + attempt(() => f4(make_string(n, pattern, place), start, c, place, o))); }
  { const place = PLACES[(a * 5 + z * 3 + 5) % PLACES.length], c = STEPS[(a + z * 7 + 5) % STEPS.length], pattern = (a + z + 5) % 6, o = { f: STEPS[(a * 3 + z + 5) % STEPS.length], get g() { return 2; } };
    lines.push("f5 Float32Array of | " + n + " " + show(start) + " " + place + " " + show(c) + " " + show(o.f) + " " + pattern + ": " + attempt(() => f5(make_Float32Array(n, pattern, place), start, c, place, o))); }
  { const place = PLACES[(a * 5 + z * 3 + 6) % PLACES.length], c = STEPS[(a + z * 7 + 6) % STEPS.length], pattern = (a + z + 6) % 6, o = { f: STEPS[(a * 3 + z + 6) % STEPS.length], get g() { return 2; } };
    lines.push("f6 Uint32Array by2 | " + n + " " + show(start) + " " + place + " " + show(c) + " " + show(o.f) + " " + pattern + ": " + attempt(() => f6(n, pattern, place, start, c, place, o))); }
  { const place = PLACES[(a * 5 + z * 3 + 7) % PLACES.length], c = STEPS[(a + z * 7 + 7) % STEPS.length], pattern = (a + z + 7) % 6, o = { f: STEPS[(a * 3 + z + 7) % STEPS.length], get g() { return 2; } };
    lines.push("f7 holes do | " + n + " " + show(start) + " " + place + " " + show(c) + " " + show(o.f) + " " + pattern + ": " + attempt(() => f7(n, pattern, place, start, c, place, o))); }
  { const place = PLACES[(a * 5 + z * 3 + 8) % PLACES.length], c = STEPS[(a + z * 7 + 8) % STEPS.length], pattern = (a + z + 8) % 6, o = { f: STEPS[(a * 3 + z + 8) % STEPS.length], get g() { return 2; } };
    lines.push("f8 resizable index | " + n + " " + show(start) + " " + place + " " + show(c) + " " + show(o.f) + " " + pattern + ": " + attempt(() => f8(make_resizable(n, pattern, place), start, c, place, o))); }
  { const place = PLACES[(a * 5 + z * 3 + 9) % PLACES.length], c = STEPS[(a + z * 7 + 9) % STEPS.length], pattern = (a + z + 9) % 6, o = { f: STEPS[(a * 3 + z + 9) % STEPS.length], get g() { return 2; } };
    lines.push("f9 Uint32Array by2 | " + n + " " + show(start) + " " + place + " " + show(c) + " " + show(o.f) + " " + pattern + ": " + attempt(() => f9(make_Uint32Array(n, pattern, place), start, c, place, o))); }
  { const place = PLACES[(a * 5 + z * 3 + 10) % PLACES.length], c = STEPS[(a + z * 7 + 10) % STEPS.length], pattern = (a + z + 10) % 6, o = { f: STEPS[(a * 3 + z + 10) % STEPS.length], get g() { return 2; } };
    lines.push("f10 Int8Array of | " + n + " " + show(start) + " " + place + " " + show(c) + " " + show(o.f) + " " + pattern + ": " + attempt(() => f10(make_Int8Array(n, pattern, place), start, c, place, o))); }
  { const place = PLACES[(a * 5 + z * 3 + 11) % PLACES.length], c = STEPS[(a + z * 7 + 11) % STEPS.length], pattern = (a + z + 11) % 6, o = { f: STEPS[(a * 3 + z + 11) % STEPS.length], get g() { return 2; } };
    lines.push("f11 Uint16Array index | " + n + " " + show(start) + " " + place + " " + show(c) + " " + show(o.f) + " " + pattern + ": " + attempt(() => f11(n, pattern, place, start, c, place, o))); }
  { const place = PLACES[(a * 5 + z * 3 + 12) % PLACES.length], c = STEPS[(a + z * 7 + 12) % STEPS.length], pattern = (a + z + 12) % 6, o = { f: STEPS[(a * 3 + z + 12) % STEPS.length], get g() { return 2; } };
    lines.push("f12 BigInt64Array down | " + n + " " + show(start) + " " + place + " " + show(c) + " " + show(o.f) + " " + pattern + ": " + attempt(() => f12(n, pattern, place, start, c, place, o))); }
  { const place = PLACES[(a * 5 + z * 3 + 13) % PLACES.length], c = STEPS[(a + z * 7 + 13) % STEPS.length], pattern = (a + z + 13) % 6, o = { f: STEPS[(a * 3 + z + 13) % STEPS.length], get g() { return 2; } };
    lines.push("f13 Uint32Array of | " + n + " " + show(start) + " " + place + " " + show(c) + " " + show(o.f) + " " + pattern + ": " + attempt(() => f13(make_Uint32Array(n, pattern, place), start, c, place, o))); }
  { const place = PLACES[(a * 5 + z * 3 + 14) % PLACES.length], c = STEPS[(a + z * 7 + 14) % STEPS.length], pattern = (a + z + 14) % 6, o = { f: STEPS[(a * 3 + z + 14) % STEPS.length], get g() { return 2; } };
    lines.push("f14 doubles by2 | " + n + " " + show(start) + " " + place + " " + show(c) + " " + show(o.f) + " " + pattern + ": " + attempt(() => f14(n, pattern, place, start, c, place, o))); }
  { const place = PLACES[(a * 5 + z * 3 + 15) % PLACES.length], c = STEPS[(a + z * 7 + 15) % STEPS.length], pattern = (a + z + 15) % 6, o = { f: STEPS[(a * 3 + z + 15) % STEPS.length], get g() { return 2; } };
    lines.push("f15 Float32Array do | " + n + " " + show(start) + " " + place + " " + show(c) + " " + show(o.f) + " " + pattern + ": " + attempt(() => f15(make_Float32Array(n, pattern, place), start, c, place, o))); }
  { const place = PLACES[(a * 5 + z * 3 + 16) % PLACES.length], c = STEPS[(a + z * 7 + 16) % STEPS.length], pattern = (a + z + 16) % 6, o = { f: STEPS[(a * 3 + z + 16) % STEPS.length], get g() { return 2; } };
    lines.push("f16 Uint32Array down | " + n + " " + show(start) + " " + place + " " + show(c) + " " + show(o.f) + " " + pattern + ": " + attempt(() => f16(n, pattern, place, start, c, place, o))); }
  { const place = PLACES[(a * 5 + z * 3 + 17) % PLACES.length], c = STEPS[(a + z * 7 + 17) % STEPS.length], pattern = (a + z + 17) % 6, o = { f: STEPS[(a * 3 + z + 17) % STEPS.length], get g() { return 2; } };
    lines.push("f17 string index | " + n + " " + show(start) + " " + place + " " + show(c) + " " + show(o.f) + " " + pattern + ": " + attempt(() => f17(make_string(n, pattern, place), start, c, place, o))); }
  { const place = PLACES[(a * 5 + z * 3 + 18) % PLACES.length], c = STEPS[(a + z * 7 + 18) % STEPS.length], pattern = (a + z + 18) % 6, o = { f: STEPS[(a * 3 + z + 18) % STEPS.length], get g() { return 2; } };
    lines.push("f18 set of | " + n + " " + show(start) + " " + place + " " + show(c) + " " + show(o.f) + " " + pattern + ": " + attempt(() => f18(make_set(n, pattern, place), start, c, place, o))); }
  { const place = PLACES[(a * 5 + z * 3 + 19) % PLACES.length], c = STEPS[(a + z * 7 + 19) % STEPS.length], pattern = (a + z + 19) % 6, o = { f: STEPS[(a * 3 + z + 19) % STEPS.length], get g() { return 2; } };
    lines.push("f19 Float64Array do | " + n + " " + show(start) + " " + place + " " + show(c) + " " + show(o.f) + " " + pattern + ": " + attempt(() => f19(n, pattern, place, start, c, place, o))); }
}
console.log(lines.join("\n"));
