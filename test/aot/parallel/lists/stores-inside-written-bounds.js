// Loops under written bounds store into lists of every kind: too short, with holes, frozen, the list that is read, a list whose kind the store changes. The length is asked once for all turns that are written out.
// STATISTIC: UnrolledIterationLengthChecks >= 100
// STATISTIC: ArrayBoundsChecksHoisted >= 100
const log = [];
let seen = 0;
class Own extends Array {}
const n = JSON.parse("3");
function show(list) {
  if (list === null || typeof list !== "object") return String(list);
  const all = [];
  for (let i = 0; i < Math.min(list.length >>> 0, 24); i++) all.push(i in list ? (Object.is(list[i], -0) ? "-0" : typeof list[i] === "object" ? "{}" : String(list[i])) : "hole");
  return list.length + ":" + all.join();
}
let changes = 0;
function change(p, t, i, k) {
  changes++;
  if (changes % 41 === 0) p[k] = "t" + changes;
  if (changes % 53 === 0) t.length = 3;
  if (changes % 67 === 0) delete p[i];
  return p[i + k];
}
const kinds = {
  "ints": () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  "doubles": () => [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5],
  "made ints": () => Array.from({ length: 16 }, (_, i) => i + n),
  "made doubles": () => Array.from({ length: 16 }, (_, i) => i / 4 + n),
  "turned doubles": () => (() => { const list = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; list[3] = 0.5 * n; return list; })(),
  "holes of ints": () => [1, , 3, 4, 5, 6, , 8, 9, 10, 11, 12, 13, 14, 15, 16],
  "holes of doubles": () => (() => { const list = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5]; delete list[6]; delete list[9]; return list; })(),
  "not a number": () => [NaN, -0, Infinity, 1, 2, 3, NaN, 5, -0, 7, 8, 9, 10, 11, 12, 13.5],
  "short ints": () => [1, 2, 3, 4, 5, 6, 7],
  "short doubles": () => [1.5, 2.5, 3.5, 4.5, 5.5, 6.5],
  "one more": () => [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5],
  "none": () => [],
  "mixed": () => [1, "2", null, 4, true, 6, undefined, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  "objects": () => [{ valueOf() { seen++; return 3; } }, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  "beyond": () => [2147483647, 2147483647, -2147483648, 4294967295, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 2147483647],
  "room of holes": () => new Array(16),
  "room filled": () => new Array(16).fill(0),
  "frozen": () => Object.freeze([1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
  "sealed": () => Object.seal([1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
  "fixed length": () => (() => { const list = [1.5, 2.5, 3.5]; Object.defineProperty(list, "length", { writable: false }); return list; })(),
  "accessor": () => (() => { const list = [1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]; Object.defineProperty(list, 5, { get() { seen++; return 0.25; }, set(value) { seen += 10; log.push("set " + value); }, configurable: true }); return list; })(),
  "own prototype": () => (() => { const list = [1.5, 2.5, , 4.5, 5.5, 6.5]; Object.setPrototypeOf(list, Object.create(Array.prototype, { 2: { value: 100.5, writable: true }, 12: { get() { seen++; return 7; }, set(value) { seen += 100; } } })); return list; })(),
  "heir": () => Own.from([1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5]),
  "far": () => (() => { const list = [1.5, 2.5]; list[100000] = 3; return list; })(),
};
const others = {
  "view": () => new Float64Array(16).fill(0.5),
  "bytes": () => new Uint8Array(16).fill(3),
  "like": () => ({ length: 16, 0: 1, 3: 4.5, 15: 2 }),
  "proxy": () => new Proxy([1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], { get(target, key, receiver) { seen++; return Reflect.get(target, key, receiver); } }),
  "text": () => "0123456789abcdef",
  "nothing": () => undefined,
};
class DoubleSlots {
  constructor() {
    this.elements = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5];
  }
  boundedStore(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < 16; i++) { let s = 0; for (let k = 0; k < 3; k++) s += p[k] * q[i & 7]; t[i] = s; }
    return this;
  }
  boundedStep(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) { let s = 0; for (let k = 0; k < 3; k++) s += p[r * 3 + k] * q[k * 3 + c]; t[r * 5 + c] = s / 2; }
    return this;
  }
  insideIf(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0.5; for (let k = 0; k < 4; k++) if (k < m) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s; }
    return this;
  }
  offset(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c + 1] = s; }
    return this;
  }
  bothEnds(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s; t[15 - r - 4 * c] = s * 0.5; }
    return this;
  }
  neighbors(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 1; i < 15; i++) { let s = 0; for (let k = 0; k < 3; k++) s += p[i + k - 1] * q[k]; t[i] = s + p[i - 1] - p[i + 1]; }
    return this;
  }
  backward(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 3; r >= 0; r--) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 3; k >= 0; k--) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s; }
    return this;
  }
  multiply(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s; }
    return this;
  }
  remainder(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s % 1 + 0.25; }
    return this;
  }
  window(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) { let s = 0; for (let k = 0; k < 3; k++) s += p[i + k] * q[k]; t[i] = s; }
    return this;
  }
  storesWithin(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) for (let k = 0; k < 4; k++) t[i * 4 + k] = p[i * 4 + k] + q[k];
    return this;
  }
  storesOnto(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) for (let k = 0; k < 2; k++) t[i + k] += p[k] * q[i];
    return this;
  }
  grows(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) { let s = 1; for (let k = 0; k < 2; k++) s += p[i + k]; t[t.length] = s * q[i]; }
    return this;
  }
  leavesWithin(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) { let s = 0; for (let k = 0; k < 4; k++) { if (p[k] > 6) break; if (q[k] === 3) continue; s += p[i + k]; } t[i] = s; }
    return this;
  }
  wholeNumbers(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) { let s = 0; for (let k = 0; k < 4; k++) s = (s * 31 + (p[(i + k) & 15] | 0)) | 0; t[i] = s; t[15 - i] = s >>> 1; }
    return this;
  }
  downward(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = m - 1; i >= 0; i--) { let s = 0; for (let k = 3; k > 0; k--) s += p[i] * q[k]; t[i] = s; }
    return this;
  }
  twoStores(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) { t[i] = p[i]; let s = 0; for (let k = 0; k < 3; k++) s += t[k]; q[i] = s; }
    return this;
  }
  calls(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) { let s = 0; for (let k = 0; k < 3; k++) s += change(p, t, i, k) * q[k]; t[i] = s; }
    return this;
  }
  run(form, a, b, m) {
    switch (form) {
      case "boundedStore":
        return this.boundedStore(a, b, m);
      case "boundedStep":
        return this.boundedStep(a, b, m);
      case "insideIf":
        return this.insideIf(a, b, m);
      case "offset":
        return this.offset(a, b, m);
      case "bothEnds":
        return this.bothEnds(a, b, m);
      case "neighbors":
        return this.neighbors(a, b, m);
      case "backward":
        return this.backward(a, b, m);
      case "multiply":
        return this.multiply(a, b, m);
      case "remainder":
        return this.remainder(a, b, m);
      case "window":
        return this.window(a, b, m);
      case "storesWithin":
        return this.storesWithin(a, b, m);
      case "storesOnto":
        return this.storesOnto(a, b, m);
      case "grows":
        return this.grows(a, b, m);
      case "leavesWithin":
        return this.leavesWithin(a, b, m);
      case "wholeNumbers":
        return this.wholeNumbers(a, b, m);
      case "downward":
        return this.downward(a, b, m);
      case "twoStores":
        return this.twoStores(a, b, m);
      case "calls":
        return this.calls(a, b, m);
    }
  }
}
class IntSlots {
  constructor() {
    this.elements = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  }
  boundedStore(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < 16; i++) { let s = 0; for (let k = 0; k < 3; k++) s += p[k] * q[i & 7]; t[i] = s; }
    return this;
  }
  boundedStep(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) { let s = 0; for (let k = 0; k < 3; k++) s += p[r * 3 + k] * q[k * 3 + c]; t[r * 5 + c] = s / 2; }
    return this;
  }
  insideIf(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0.5; for (let k = 0; k < 4; k++) if (k < m) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s; }
    return this;
  }
  offset(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c + 1] = s; }
    return this;
  }
  bothEnds(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s; t[15 - r - 4 * c] = s * 0.5; }
    return this;
  }
  neighbors(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 1; i < 15; i++) { let s = 0; for (let k = 0; k < 3; k++) s += p[i + k - 1] * q[k]; t[i] = s + p[i - 1] - p[i + 1]; }
    return this;
  }
  backward(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 3; r >= 0; r--) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 3; k >= 0; k--) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s; }
    return this;
  }
  multiply(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s; }
    return this;
  }
  remainder(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s % 1 + 0.25; }
    return this;
  }
  window(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) { let s = 0; for (let k = 0; k < 3; k++) s += p[i + k] * q[k]; t[i] = s; }
    return this;
  }
  storesWithin(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) for (let k = 0; k < 4; k++) t[i * 4 + k] = p[i * 4 + k] + q[k];
    return this;
  }
  storesOnto(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) for (let k = 0; k < 2; k++) t[i + k] += p[k] * q[i];
    return this;
  }
  grows(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) { let s = 1; for (let k = 0; k < 2; k++) s += p[i + k]; t[t.length] = s * q[i]; }
    return this;
  }
  leavesWithin(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) { let s = 0; for (let k = 0; k < 4; k++) { if (p[k] > 6) break; if (q[k] === 3) continue; s += p[i + k]; } t[i] = s; }
    return this;
  }
  wholeNumbers(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) { let s = 0; for (let k = 0; k < 4; k++) s = (s * 31 + (p[(i + k) & 15] | 0)) | 0; t[i] = s; t[15 - i] = s >>> 1; }
    return this;
  }
  downward(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = m - 1; i >= 0; i--) { let s = 0; for (let k = 3; k > 0; k--) s += p[i] * q[k]; t[i] = s; }
    return this;
  }
  twoStores(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) { t[i] = p[i]; let s = 0; for (let k = 0; k < 3; k++) s += t[k]; q[i] = s; }
    return this;
  }
  calls(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) { let s = 0; for (let k = 0; k < 3; k++) s += change(p, t, i, k) * q[k]; t[i] = s; }
    return this;
  }
  run(form, a, b, m) {
    switch (form) {
      case "boundedStore":
        return this.boundedStore(a, b, m);
      case "boundedStep":
        return this.boundedStep(a, b, m);
      case "insideIf":
        return this.insideIf(a, b, m);
      case "offset":
        return this.offset(a, b, m);
      case "bothEnds":
        return this.bothEnds(a, b, m);
      case "neighbors":
        return this.neighbors(a, b, m);
      case "backward":
        return this.backward(a, b, m);
      case "multiply":
        return this.multiply(a, b, m);
      case "remainder":
        return this.remainder(a, b, m);
      case "window":
        return this.window(a, b, m);
      case "storesWithin":
        return this.storesWithin(a, b, m);
      case "storesOnto":
        return this.storesOnto(a, b, m);
      case "grows":
        return this.grows(a, b, m);
      case "leavesWithin":
        return this.leavesWithin(a, b, m);
      case "wholeNumbers":
        return this.wholeNumbers(a, b, m);
      case "downward":
        return this.downward(a, b, m);
      case "twoStores":
        return this.twoStores(a, b, m);
      case "calls":
        return this.calls(a, b, m);
    }
  }
}
class TurnedSlots {
  constructor() {
    this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }
  boundedStore(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < 16; i++) { let s = 0; for (let k = 0; k < 3; k++) s += p[k] * q[i & 7]; t[i] = s; }
    return this;
  }
  boundedStep(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) { let s = 0; for (let k = 0; k < 3; k++) s += p[r * 3 + k] * q[k * 3 + c]; t[r * 5 + c] = s / 2; }
    return this;
  }
  insideIf(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0.5; for (let k = 0; k < 4; k++) if (k < m) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s; }
    return this;
  }
  offset(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c + 1] = s; }
    return this;
  }
  bothEnds(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s; t[15 - r - 4 * c] = s * 0.5; }
    return this;
  }
  neighbors(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 1; i < 15; i++) { let s = 0; for (let k = 0; k < 3; k++) s += p[i + k - 1] * q[k]; t[i] = s + p[i - 1] - p[i + 1]; }
    return this;
  }
  backward(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 3; r >= 0; r--) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 3; k >= 0; k--) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s; }
    return this;
  }
  multiply(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s; }
    return this;
  }
  remainder(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s % 1 + 0.25; }
    return this;
  }
  window(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) { let s = 0; for (let k = 0; k < 3; k++) s += p[i + k] * q[k]; t[i] = s; }
    return this;
  }
  storesWithin(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) for (let k = 0; k < 4; k++) t[i * 4 + k] = p[i * 4 + k] + q[k];
    return this;
  }
  storesOnto(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) for (let k = 0; k < 2; k++) t[i + k] += p[k] * q[i];
    return this;
  }
  grows(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) { let s = 1; for (let k = 0; k < 2; k++) s += p[i + k]; t[t.length] = s * q[i]; }
    return this;
  }
  leavesWithin(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) { let s = 0; for (let k = 0; k < 4; k++) { if (p[k] > 6) break; if (q[k] === 3) continue; s += p[i + k]; } t[i] = s; }
    return this;
  }
  wholeNumbers(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) { let s = 0; for (let k = 0; k < 4; k++) s = (s * 31 + (p[(i + k) & 15] | 0)) | 0; t[i] = s; t[15 - i] = s >>> 1; }
    return this;
  }
  downward(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = m - 1; i >= 0; i--) { let s = 0; for (let k = 3; k > 0; k--) s += p[i] * q[k]; t[i] = s; }
    return this;
  }
  twoStores(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) { t[i] = p[i]; let s = 0; for (let k = 0; k < 3; k++) s += t[k]; q[i] = s; }
    return this;
  }
  calls(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) { let s = 0; for (let k = 0; k < 3; k++) s += change(p, t, i, k) * q[k]; t[i] = s; }
    return this;
  }
  run(form, a, b, m) {
    switch (form) {
      case "boundedStore":
        return this.boundedStore(a, b, m);
      case "boundedStep":
        return this.boundedStep(a, b, m);
      case "insideIf":
        return this.insideIf(a, b, m);
      case "offset":
        return this.offset(a, b, m);
      case "bothEnds":
        return this.bothEnds(a, b, m);
      case "neighbors":
        return this.neighbors(a, b, m);
      case "backward":
        return this.backward(a, b, m);
      case "multiply":
        return this.multiply(a, b, m);
      case "remainder":
        return this.remainder(a, b, m);
      case "window":
        return this.window(a, b, m);
      case "storesWithin":
        return this.storesWithin(a, b, m);
      case "storesOnto":
        return this.storesOnto(a, b, m);
      case "grows":
        return this.grows(a, b, m);
      case "leavesWithin":
        return this.leavesWithin(a, b, m);
      case "wholeNumbers":
        return this.wholeNumbers(a, b, m);
      case "downward":
        return this.downward(a, b, m);
      case "twoStores":
        return this.twoStores(a, b, m);
      case "calls":
        return this.calls(a, b, m);
    }
  }
}
for (const made of [new TurnedSlots(), new TurnedSlots()]) made.elements[2] = Math.cos(n);
class Holder {
  constructor(elements) {
    this.elements = elements;
  }
  boundedStore(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < 16; i++) { let s = 0; for (let k = 0; k < 3; k++) s += p[k] * q[i & 7]; t[i] = s; }
    return this;
  }
  boundedStep(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) { let s = 0; for (let k = 0; k < 3; k++) s += p[r * 3 + k] * q[k * 3 + c]; t[r * 5 + c] = s / 2; }
    return this;
  }
  insideIf(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0.5; for (let k = 0; k < 4; k++) if (k < m) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s; }
    return this;
  }
  offset(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c + 1] = s; }
    return this;
  }
  bothEnds(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s; t[15 - r - 4 * c] = s * 0.5; }
    return this;
  }
  neighbors(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 1; i < 15; i++) { let s = 0; for (let k = 0; k < 3; k++) s += p[i + k - 1] * q[k]; t[i] = s + p[i - 1] - p[i + 1]; }
    return this;
  }
  backward(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 3; r >= 0; r--) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 3; k >= 0; k--) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s; }
    return this;
  }
  multiply(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s; }
    return this;
  }
  remainder(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s % 1 + 0.25; }
    return this;
  }
  window(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) { let s = 0; for (let k = 0; k < 3; k++) s += p[i + k] * q[k]; t[i] = s; }
    return this;
  }
  storesWithin(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) for (let k = 0; k < 4; k++) t[i * 4 + k] = p[i * 4 + k] + q[k];
    return this;
  }
  storesOnto(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) for (let k = 0; k < 2; k++) t[i + k] += p[k] * q[i];
    return this;
  }
  grows(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) { let s = 1; for (let k = 0; k < 2; k++) s += p[i + k]; t[t.length] = s * q[i]; }
    return this;
  }
  leavesWithin(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) { let s = 0; for (let k = 0; k < 4; k++) { if (p[k] > 6) break; if (q[k] === 3) continue; s += p[i + k]; } t[i] = s; }
    return this;
  }
  wholeNumbers(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) { let s = 0; for (let k = 0; k < 4; k++) s = (s * 31 + (p[(i + k) & 15] | 0)) | 0; t[i] = s; t[15 - i] = s >>> 1; }
    return this;
  }
  downward(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = m - 1; i >= 0; i--) { let s = 0; for (let k = 3; k > 0; k--) s += p[i] * q[k]; t[i] = s; }
    return this;
  }
  twoStores(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) { t[i] = p[i]; let s = 0; for (let k = 0; k < 3; k++) s += t[k]; q[i] = s; }
    return this;
  }
  calls(a, b, m) {
    const p = a.elements, q = b.elements, t = this.elements;
    for (let i = 0; i < m; i++) { let s = 0; for (let k = 0; k < 3; k++) s += change(p, t, i, k) * q[k]; t[i] = s; }
    return this;
  }
}
function boundedStoreOfLists(p, q, t, m) {
  for (let i = 0; i < 16; i++) { let s = 0; for (let k = 0; k < 3; k++) s += p[k] * q[i & 7]; t[i] = s; }
}
function boundedStepOfLists(p, q, t, m) {
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) { let s = 0; for (let k = 0; k < 3; k++) s += p[r * 3 + k] * q[k * 3 + c]; t[r * 5 + c] = s / 2; }
}
function insideIfOfLists(p, q, t, m) {
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0.5; for (let k = 0; k < 4; k++) if (k < m) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s; }
}
function offsetOfLists(p, q, t, m) {
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c + 1] = s; }
}
function bothEndsOfLists(p, q, t, m) {
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s; t[15 - r - 4 * c] = s * 0.5; }
}
function neighborsOfLists(p, q, t, m) {
  for (let i = 1; i < 15; i++) { let s = 0; for (let k = 0; k < 3; k++) s += p[i + k - 1] * q[k]; t[i] = s + p[i - 1] - p[i + 1]; }
}
function backwardOfLists(p, q, t, m) {
  for (let r = 3; r >= 0; r--) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 3; k >= 0; k--) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s; }
}
function multiplyOfLists(p, q, t, m) {
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s; }
}
function remainderOfLists(p, q, t, m) {
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s % 1 + 0.25; }
}
function windowOfLists(p, q, t, m) {
  for (let i = 0; i < m; i++) { let s = 0; for (let k = 0; k < 3; k++) s += p[i + k] * q[k]; t[i] = s; }
}
function storesWithinOfLists(p, q, t, m) {
  for (let i = 0; i < m; i++) for (let k = 0; k < 4; k++) t[i * 4 + k] = p[i * 4 + k] + q[k];
}
function storesOntoOfLists(p, q, t, m) {
  for (let i = 0; i < m; i++) for (let k = 0; k < 2; k++) t[i + k] += p[k] * q[i];
}
function growsOfLists(p, q, t, m) {
  for (let i = 0; i < m; i++) { let s = 1; for (let k = 0; k < 2; k++) s += p[i + k]; t[t.length] = s * q[i]; }
}
function leavesWithinOfLists(p, q, t, m) {
  for (let i = 0; i < m; i++) { let s = 0; for (let k = 0; k < 4; k++) { if (p[k] > 6) break; if (q[k] === 3) continue; s += p[i + k]; } t[i] = s; }
}
function wholeNumbersOfLists(p, q, t, m) {
  for (let i = 0; i < m; i++) { let s = 0; for (let k = 0; k < 4; k++) s = (s * 31 + (p[(i + k) & 15] | 0)) | 0; t[i] = s; t[15 - i] = s >>> 1; }
}
function downwardOfLists(p, q, t, m) {
  for (let i = m - 1; i >= 0; i--) { let s = 0; for (let k = 3; k > 0; k--) s += p[i] * q[k]; t[i] = s; }
}
function twoStoresOfLists(p, q, t, m) {
  for (let i = 0; i < m; i++) { t[i] = p[i]; let s = 0; for (let k = 0; k < 3; k++) s += t[k]; q[i] = s; }
}
function callsOfLists(p, q, t, m) {
  for (let i = 0; i < m; i++) { let s = 0; for (let k = 0; k < 3; k++) s += change(p, t, i, k) * q[k]; t[i] = s; }
}
const byFields = ["boundedStore", "boundedStep", "insideIf", "offset", "bothEnds", "neighbors", "backward", "multiply", "remainder", "window", "storesWithin", "storesOnto", "grows", "leavesWithin", "wholeNumbers", "downward", "twoStores", "calls"];
const byLists = { boundedStore: boundedStoreOfLists, boundedStep: boundedStepOfLists, insideIf: insideIfOfLists, offset: offsetOfLists, bothEnds: bothEndsOfLists, neighbors: neighborsOfLists, backward: backwardOfLists, multiply: multiplyOfLists, remainder: remainderOfLists, window: windowOfLists, storesWithin: storesWithinOfLists, storesOnto: storesOntoOfLists, grows: growsOfLists, leavesWithin: leavesWithinOfLists, wholeNumbers: wholeNumbersOfLists, downward: downwardOfLists, twoStores: twoStoresOfLists, calls: callsOfLists };
let numberOfCase = 0;
function attempt(name, p, q, t, m, run) {
  if (numberOfCase++ % 13) return;
  seen = 0;
  changes = 0;
  let end = "";
  try {
    run();
  } catch (error) {
    end = " " + error.name;
  }
  log.push(name + end + " " + show(p) + " | " + show(q) + " | " + show(t) + " | " + seen);
}
function cases(makeP, makeQ, makeT, label, throughFields) {
  for (const m of [0, 1, n + 5]) {
    for (const form of byFields) {
      const p = makeP(), q = makeQ(), t = makeT();
      if (throughFields) attempt("field " + form + " " + label + " " + m, p, q, t, m, () => new Holder(t).run(form, new Holder(p), new Holder(q), m));
      else attempt("lists " + form + " " + label + " " + m, p, q, t, m, () => byLists[form](p, q, t, m));
    }
  }
}
Holder.prototype.run = function (form, a, b, m) {
  switch (form) {
    case "boundedStore":
      return this.boundedStore(a, b, m);
    case "boundedStep":
      return this.boundedStep(a, b, m);
    case "insideIf":
      return this.insideIf(a, b, m);
    case "offset":
      return this.offset(a, b, m);
    case "bothEnds":
      return this.bothEnds(a, b, m);
    case "neighbors":
      return this.neighbors(a, b, m);
    case "backward":
      return this.backward(a, b, m);
    case "multiply":
      return this.multiply(a, b, m);
    case "remainder":
      return this.remainder(a, b, m);
    case "window":
      return this.window(a, b, m);
    case "storesWithin":
      return this.storesWithin(a, b, m);
    case "storesOnto":
      return this.storesOnto(a, b, m);
    case "grows":
      return this.grows(a, b, m);
    case "leavesWithin":
      return this.leavesWithin(a, b, m);
    case "wholeNumbers":
      return this.wholeNumbers(a, b, m);
    case "downward":
      return this.downward(a, b, m);
    case "twoStores":
      return this.twoStores(a, b, m);
    case "calls":
      return this.calls(a, b, m);
  }
};
const doubles = kinds["made doubles"], ints = kinds["made ints"];
const changesOfSlots = {
  none: list => list,
  hole: list => delete list[6],
  holes: list => { delete list[0]; delete list[15]; },
  shorter: list => (list.length = 6),
  empty: list => (list.length = 0),
  longer: list => list.push(17),
  "not a number": list => (list[0] = NaN),
  whole: list => list.fill(n),
  beyond: list => (list[1] = 4294967296 * n),
  frozen: list => Object.freeze(list),
  sealed: list => Object.seal(list),
  "fixed length": list => { list.length = 5; Object.defineProperty(list, "length", { writable: false }); },
  accessor: list => Object.defineProperty(list, 5, { get() { seen++; return 0.25; }, set(value) { seen += 10; }, configurable: true }),
  "own prototype": list => { delete list[2]; list.length = 12; Object.setPrototypeOf(list, Object.create(Array.prototype, { 2: { value: 100.5, writable: true }, 12: { get() { seen++; return 7; }, set(value) { seen += 100; } } })); },
  "no prototype": list => { delete list[2]; Object.setPrototypeOf(list, null); },
  far: list => (list[100000] = 1),
};
for (const change of Object.keys(changesOfSlots)) {
  for (const [label, Slots] of [["doubles", DoubleSlots], ["ints", IntSlots], ["turned", TurnedSlots]]) {
    for (const m of [0, n, 8]) {
      for (const form of byFields) {
        for (const place of ["p", "q", "t", "all", "one", "p is t"]) {
          const p = new Slots(), q = place === "one" ? p : new Slots(), t = place === "one" || place === "p is t" ? p : new Slots();
          if (place === "p" || place === "all") changesOfSlots[change](p.elements);
          if (place === "q" || place === "all") changesOfSlots[change](q.elements);
          if (place === "t" || place === "all" || place === "one" || place === "p is t") if (!(place === "all" && Object.isFrozen(t.elements))) changesOfSlots[change](t.elements);
          attempt("slots " + label + " " + change + " " + form + " " + place + " " + m, p.elements, q.elements, t.elements, m, () => t.run(form, p, q, m));
        }
      }
    }
  }
}
for (const throughFields of [true, false]) {
  for (const kind of Object.keys(kinds)) {
    cases(kinds[kind], doubles, kinds["room filled"], "p " + kind, throughFields);
    cases(doubles, kinds[kind], doubles, "q " + kind, throughFields);
    cases(doubles, doubles, kinds[kind], "t " + kind, throughFields);
    cases(ints, ints, kinds[kind], "t of ints " + kind, throughFields);
    cases(kinds[kind], ints, kinds[kind], "p t " + kind, throughFields);
    const same = kinds[kind]();
    cases(() => same, () => same, () => same, "one list " + kind, throughFields);
    const shared = kinds[kind]();
    cases(() => shared, doubles, () => shared, "p is t " + kind, throughFields);
  }
}
for (const kind of Object.keys(others)) {
  cases(others[kind], doubles, kinds["room filled"], "p " + kind, false);
  cases(doubles, others[kind], doubles, "q " + kind, false);
  cases(doubles, doubles, others[kind], "t " + kind, false);
}
let sum = 0;
for (const line of log) for (let i = 0; i < line.length; i++) sum = (sum * 31 + line.charCodeAt(i)) | 0;
console.log(log.length, sum);
for (let i = 0; i < log.length; i += 11) console.log(log[i]);
