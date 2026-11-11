// Several reads of one list of numbers under written indexes ask once for the list, its length and its kind: a hole, a list that is too short, one that changes its kind between two reads, and an operand that is no number answer as they do one by one.
// STATISTIC: ListsGuardedForReads >= 20
const log = [];
let seen = 0;
let numberOfCase = 0;
const n = JSON.parse("3");
function show(value) {
  if (Array.isArray(value)) {
    const all = [];
    for (let i = 0; i < Math.min(value.length, 20); i++) all.push(i in value ? show(value[i]) : "hole");
    return value.length + ":" + all.join();
  }
  return Object.is(value, -0) ? "-0" : typeof value === "object" && value !== null ? "{}" : typeof value === "string" ? JSON.stringify(value) : String(value);
}
class Doubles {
  constructor() {
    this.elements = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5];
    this.a = 0;
    this.b = 0.5;
    this.c = 0;
  }
  none() {
    
  }
  hole() {
    this.elements.length = 2; this.elements[3] = 0.5; this.elements[15] = 7;
  }
  holes() {
    this.elements.length = 0; this.elements[1] = 1; this.elements[15] = 2.5;
  }
  shorter() {
    this.elements.length = 6;
  }
  short() {
    this.elements.length = 2;
  }
  empty() {
    this.elements.length = 0;
  }
  longer() {
    this.elements.push(17, 18, 19);
  }
  notANumber() {
    this.elements[1] = NaN;
  }
  minus() {
    this.elements[0] = -0;
  }
  whole() {
    for (let i = 0; i < this.elements.length; i++) this.elements[i] = i;
  }
  fraction() {
    this.elements[3] = 0.25 * n;
  }
  beyond() {
    this.elements[1] = 4294967296 * n;
  }
  far() {
    this.elements[100000] = 1;
  }
  farHole() {
    this.elements.length = 100001;
  }
  replaced() {
    this.elements = [0.5, 1, 1.5, 2];
  }
  text() {
    let text = this.elements.length + ":";
    for (let i = 0; i < Math.min(this.elements.length, 20); i++) text += (this.elements[i] === 0 ? String(1 / this.elements[i]) : this.elements[i]) + ",";
    return text;
  }
  changeBy(by) {
    if (by === 1) this.elements[1] = 2.5;
    if (by === 2) this.elements.length = 2;
    if (by === 5) { this.elements.length = 1; this.elements[5] = 2; }
  }
  applyOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]); out.push((e[0] * x + e[4] * y + e[8] * z + e[12]) * w, (e[1] * x + e[5] * y + e[9] * z + e[13]) * w, (e[2] * x + e[6] * y + e[10] * z + e[14]) * w);
    return undefined;
  }
  determinantOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    const a = e[0], b = e[1], c = e[2], d = e[3], f = e[4], g = e[5], h = e[6], i = e[7], j = e[8]; out.push(a * f * j - a * g * i - b * d * j + b * g * h + c * d * i - c * f * h + x);
    return undefined;
  }
  sumsOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    out.push(e[0] + e[1] + e[2] + e[3]); out.push(e[4] - e[5] - e[6]); out.push(e[1] + x + e[2] + y);
    return undefined;
  }
  bitsOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    out.push((e[0] | 0) + (e[1] ^ e[2]) + (e[3] & 255), e[4] >> 1, e[5] < e[6], e[0] === e[1]);
    return undefined;
  }
  storesOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    const s = e[0] * e[1] + e[2] * e[3]; e[0] = s; e[1] = e[0] + e[2] + e[3]; e[2] = e[1] * e[0] * e[3]; out.push(s);
    return undefined;
  }
  twoListsOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    out.push(e[0] * t[0] + e[1] * t[4] + e[2] * t[8], e[4] * t[1] + e[5] * t[5] + e[6] * t[9]);
    return undefined;
  }
  farOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    out.push(e[0] + e[1] + e[15] + e[40000], e[2] * e[3] * e[65535]);
    return undefined;
  }
  calledOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    out.push(e[0] + e[1]); other.changeBy(x); out.push(e[0] + e[1] + e[2] + e[3]); other.changeBy(y); out.push(e[1] * e[2] * e[3]);
    return undefined;
  }
  branchesOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    if (x > 1) out.push(e[0] + e[1] + e[2]); else out.push(e[3] + e[4] + e[5]); out.push(x > 2 ? e[6] * e[7] * e[8] : e[0]);
    return undefined;
  }
  returnedOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    return e[0] * x + e[1] * y + e[2] * z + e[3];
    return undefined;
  }
  betweenOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    this.a = e[0] * x; this.b = e[1] + e[2] + this.a; other.hole(); this.a = e[2] * e[3] + e[4]; out.push(this.a, this.b, e[0] + e[1] + e[2]);
    return undefined;
  }
  slotsOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    this.a = e[0] * x + e[1] * y; this.b = e[2] * x + e[3] * y; this.c = e[4] * z + e[5] * this.a; out.push(this.a, this.b, this.c);
    return undefined;
  }
  growingOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    out.push(e[16] + e[17] + e[18], e[15] * e[14] * e[13]);
    return undefined;
  }
  change(kind) {
    switch (kind) {
      case "none":
        return this.none();
      case "hole":
        return this.hole();
      case "holes":
        return this.holes();
      case "shorter":
        return this.shorter();
      case "short":
        return this.short();
      case "empty":
        return this.empty();
      case "longer":
        return this.longer();
      case "notANumber":
        return this.notANumber();
      case "minus":
        return this.minus();
      case "whole":
        return this.whole();
      case "fraction":
        return this.fraction();
      case "beyond":
        return this.beyond();
      case "far":
        return this.far();
      case "farHole":
        return this.farHole();
      case "replaced":
        return this.replaced();
    }
  }
  run(form, x, y, z, other, out) {
    switch (form) {
      case "apply":
        return this.applyOf(x, y, z, other, out);
      case "determinant":
        return this.determinantOf(x, y, z, other, out);
      case "sums":
        return this.sumsOf(x, y, z, other, out);
      case "bits":
        return this.bitsOf(x, y, z, other, out);
      case "stores":
        return this.storesOf(x, y, z, other, out);
      case "twoLists":
        return this.twoListsOf(x, y, z, other, out);
      case "far":
        return this.farOf(x, y, z, other, out);
      case "called":
        return this.calledOf(x, y, z, other, out);
      case "branches":
        return this.branchesOf(x, y, z, other, out);
      case "returned":
        return this.returnedOf(x, y, z, other, out);
      case "between":
        return this.betweenOf(x, y, z, other, out);
      case "slots":
        return this.slotsOf(x, y, z, other, out);
      case "growing":
        return this.growingOf(x, y, z, other, out);
    }
  }
}
class Ints {
  constructor() {
    this.elements = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    this.a = 0;
    this.b = 0.5;
    this.c = 0;
  }
  none() {
    
  }
  hole() {
    this.elements.length = 2; this.elements[3] = 0.5; this.elements[15] = 7;
  }
  holes() {
    this.elements.length = 0; this.elements[1] = 1; this.elements[15] = 2.5;
  }
  shorter() {
    this.elements.length = 6;
  }
  short() {
    this.elements.length = 2;
  }
  empty() {
    this.elements.length = 0;
  }
  longer() {
    this.elements.push(17, 18, 19);
  }
  notANumber() {
    this.elements[1] = NaN;
  }
  minus() {
    this.elements[0] = -0;
  }
  whole() {
    for (let i = 0; i < this.elements.length; i++) this.elements[i] = i;
  }
  fraction() {
    this.elements[3] = 0.25 * n;
  }
  beyond() {
    this.elements[1] = 4294967296 * n;
  }
  far() {
    this.elements[100000] = 1;
  }
  farHole() {
    this.elements.length = 100001;
  }
  replaced() {
    this.elements = [0.5, 1, 1.5, 2];
  }
  text() {
    let text = this.elements.length + ":";
    for (let i = 0; i < Math.min(this.elements.length, 20); i++) text += (this.elements[i] === 0 ? String(1 / this.elements[i]) : this.elements[i]) + ",";
    return text;
  }
  changeBy(by) {
    if (by === 1) this.elements[1] = 2.5;
    if (by === 2) this.elements.length = 2;
    if (by === 5) { this.elements.length = 1; this.elements[5] = 2; }
  }
  applyOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]); out.push((e[0] * x + e[4] * y + e[8] * z + e[12]) * w, (e[1] * x + e[5] * y + e[9] * z + e[13]) * w, (e[2] * x + e[6] * y + e[10] * z + e[14]) * w);
    return undefined;
  }
  determinantOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    const a = e[0], b = e[1], c = e[2], d = e[3], f = e[4], g = e[5], h = e[6], i = e[7], j = e[8]; out.push(a * f * j - a * g * i - b * d * j + b * g * h + c * d * i - c * f * h + x);
    return undefined;
  }
  sumsOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    out.push(e[0] + e[1] + e[2] + e[3]); out.push(e[4] - e[5] - e[6]); out.push(e[1] + x + e[2] + y);
    return undefined;
  }
  bitsOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    out.push((e[0] | 0) + (e[1] ^ e[2]) + (e[3] & 255), e[4] >> 1, e[5] < e[6], e[0] === e[1]);
    return undefined;
  }
  storesOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    const s = e[0] * e[1] + e[2] * e[3]; e[0] = s; e[1] = e[0] + e[2] + e[3]; e[2] = e[1] * e[0] * e[3]; out.push(s);
    return undefined;
  }
  twoListsOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    out.push(e[0] * t[0] + e[1] * t[4] + e[2] * t[8], e[4] * t[1] + e[5] * t[5] + e[6] * t[9]);
    return undefined;
  }
  farOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    out.push(e[0] + e[1] + e[15] + e[40000], e[2] * e[3] * e[65535]);
    return undefined;
  }
  calledOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    out.push(e[0] + e[1]); other.changeBy(x); out.push(e[0] + e[1] + e[2] + e[3]); other.changeBy(y); out.push(e[1] * e[2] * e[3]);
    return undefined;
  }
  branchesOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    if (x > 1) out.push(e[0] + e[1] + e[2]); else out.push(e[3] + e[4] + e[5]); out.push(x > 2 ? e[6] * e[7] * e[8] : e[0]);
    return undefined;
  }
  returnedOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    return e[0] * x + e[1] * y + e[2] * z + e[3];
    return undefined;
  }
  betweenOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    this.a = e[0] * x; this.b = e[1] + e[2] + this.a; other.hole(); this.a = e[2] * e[3] + e[4]; out.push(this.a, this.b, e[0] + e[1] + e[2]);
    return undefined;
  }
  slotsOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    this.a = e[0] * x + e[1] * y; this.b = e[2] * x + e[3] * y; this.c = e[4] * z + e[5] * this.a; out.push(this.a, this.b, this.c);
    return undefined;
  }
  growingOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    out.push(e[16] + e[17] + e[18], e[15] * e[14] * e[13]);
    return undefined;
  }
  change(kind) {
    switch (kind) {
      case "none":
        return this.none();
      case "hole":
        return this.hole();
      case "holes":
        return this.holes();
      case "shorter":
        return this.shorter();
      case "short":
        return this.short();
      case "empty":
        return this.empty();
      case "longer":
        return this.longer();
      case "notANumber":
        return this.notANumber();
      case "minus":
        return this.minus();
      case "whole":
        return this.whole();
      case "fraction":
        return this.fraction();
      case "beyond":
        return this.beyond();
      case "far":
        return this.far();
      case "farHole":
        return this.farHole();
      case "replaced":
        return this.replaced();
    }
  }
  run(form, x, y, z, other, out) {
    switch (form) {
      case "apply":
        return this.applyOf(x, y, z, other, out);
      case "determinant":
        return this.determinantOf(x, y, z, other, out);
      case "sums":
        return this.sumsOf(x, y, z, other, out);
      case "bits":
        return this.bitsOf(x, y, z, other, out);
      case "stores":
        return this.storesOf(x, y, z, other, out);
      case "twoLists":
        return this.twoListsOf(x, y, z, other, out);
      case "far":
        return this.farOf(x, y, z, other, out);
      case "called":
        return this.calledOf(x, y, z, other, out);
      case "branches":
        return this.branchesOf(x, y, z, other, out);
      case "returned":
        return this.returnedOf(x, y, z, other, out);
      case "between":
        return this.betweenOf(x, y, z, other, out);
      case "slots":
        return this.slotsOf(x, y, z, other, out);
      case "growing":
        return this.growingOf(x, y, z, other, out);
    }
  }
}
class Mixed {
  constructor() {
    this.elements = [1, 0, 0.5, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    this.a = 0;
    this.b = 0.5;
    this.c = 0;
  }
  none() {
    
  }
  hole() {
    this.elements.length = 2; this.elements[3] = 0.5; this.elements[15] = 7;
  }
  holes() {
    this.elements.length = 0; this.elements[1] = 1; this.elements[15] = 2.5;
  }
  shorter() {
    this.elements.length = 6;
  }
  short() {
    this.elements.length = 2;
  }
  empty() {
    this.elements.length = 0;
  }
  longer() {
    this.elements.push(17, 18, 19);
  }
  notANumber() {
    this.elements[1] = NaN;
  }
  minus() {
    this.elements[0] = -0;
  }
  whole() {
    for (let i = 0; i < this.elements.length; i++) this.elements[i] = i;
  }
  fraction() {
    this.elements[3] = 0.25 * n;
  }
  beyond() {
    this.elements[1] = 4294967296 * n;
  }
  far() {
    this.elements[100000] = 1;
  }
  farHole() {
    this.elements.length = 100001;
  }
  replaced() {
    this.elements = [0.5, 1, 1.5, 2];
  }
  text() {
    let text = this.elements.length + ":";
    for (let i = 0; i < Math.min(this.elements.length, 20); i++) text += (this.elements[i] === 0 ? String(1 / this.elements[i]) : this.elements[i]) + ",";
    return text;
  }
  changeBy(by) {
    if (by === 1) this.elements[1] = 2.5;
    if (by === 2) this.elements.length = 2;
    if (by === 5) { this.elements.length = 1; this.elements[5] = 2; }
  }
  applyOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]); out.push((e[0] * x + e[4] * y + e[8] * z + e[12]) * w, (e[1] * x + e[5] * y + e[9] * z + e[13]) * w, (e[2] * x + e[6] * y + e[10] * z + e[14]) * w);
    return undefined;
  }
  determinantOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    const a = e[0], b = e[1], c = e[2], d = e[3], f = e[4], g = e[5], h = e[6], i = e[7], j = e[8]; out.push(a * f * j - a * g * i - b * d * j + b * g * h + c * d * i - c * f * h + x);
    return undefined;
  }
  sumsOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    out.push(e[0] + e[1] + e[2] + e[3]); out.push(e[4] - e[5] - e[6]); out.push(e[1] + x + e[2] + y);
    return undefined;
  }
  bitsOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    out.push((e[0] | 0) + (e[1] ^ e[2]) + (e[3] & 255), e[4] >> 1, e[5] < e[6], e[0] === e[1]);
    return undefined;
  }
  storesOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    const s = e[0] * e[1] + e[2] * e[3]; e[0] = s; e[1] = e[0] + e[2] + e[3]; e[2] = e[1] * e[0] * e[3]; out.push(s);
    return undefined;
  }
  twoListsOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    out.push(e[0] * t[0] + e[1] * t[4] + e[2] * t[8], e[4] * t[1] + e[5] * t[5] + e[6] * t[9]);
    return undefined;
  }
  farOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    out.push(e[0] + e[1] + e[15] + e[40000], e[2] * e[3] * e[65535]);
    return undefined;
  }
  calledOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    out.push(e[0] + e[1]); other.changeBy(x); out.push(e[0] + e[1] + e[2] + e[3]); other.changeBy(y); out.push(e[1] * e[2] * e[3]);
    return undefined;
  }
  branchesOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    if (x > 1) out.push(e[0] + e[1] + e[2]); else out.push(e[3] + e[4] + e[5]); out.push(x > 2 ? e[6] * e[7] * e[8] : e[0]);
    return undefined;
  }
  returnedOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    return e[0] * x + e[1] * y + e[2] * z + e[3];
    return undefined;
  }
  betweenOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    this.a = e[0] * x; this.b = e[1] + e[2] + this.a; other.hole(); this.a = e[2] * e[3] + e[4]; out.push(this.a, this.b, e[0] + e[1] + e[2]);
    return undefined;
  }
  slotsOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    this.a = e[0] * x + e[1] * y; this.b = e[2] * x + e[3] * y; this.c = e[4] * z + e[5] * this.a; out.push(this.a, this.b, this.c);
    return undefined;
  }
  growingOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    out.push(e[16] + e[17] + e[18], e[15] * e[14] * e[13]);
    return undefined;
  }
  change(kind) {
    switch (kind) {
      case "none":
        return this.none();
      case "hole":
        return this.hole();
      case "holes":
        return this.holes();
      case "shorter":
        return this.shorter();
      case "short":
        return this.short();
      case "empty":
        return this.empty();
      case "longer":
        return this.longer();
      case "notANumber":
        return this.notANumber();
      case "minus":
        return this.minus();
      case "whole":
        return this.whole();
      case "fraction":
        return this.fraction();
      case "beyond":
        return this.beyond();
      case "far":
        return this.far();
      case "farHole":
        return this.farHole();
      case "replaced":
        return this.replaced();
    }
  }
  run(form, x, y, z, other, out) {
    switch (form) {
      case "apply":
        return this.applyOf(x, y, z, other, out);
      case "determinant":
        return this.determinantOf(x, y, z, other, out);
      case "sums":
        return this.sumsOf(x, y, z, other, out);
      case "bits":
        return this.bitsOf(x, y, z, other, out);
      case "stores":
        return this.storesOf(x, y, z, other, out);
      case "twoLists":
        return this.twoListsOf(x, y, z, other, out);
      case "far":
        return this.farOf(x, y, z, other, out);
      case "called":
        return this.calledOf(x, y, z, other, out);
      case "branches":
        return this.branchesOf(x, y, z, other, out);
      case "returned":
        return this.returnedOf(x, y, z, other, out);
      case "between":
        return this.betweenOf(x, y, z, other, out);
      case "slots":
        return this.slotsOf(x, y, z, other, out);
      case "growing":
        return this.growingOf(x, y, z, other, out);
    }
  }
}
class Holes {
  constructor() {
    this.elements = [1.5, , 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    this.a = 0;
    this.b = 0.5;
    this.c = 0;
  }
  none() {
    
  }
  hole() {
    this.elements.length = 2; this.elements[3] = 0.5; this.elements[15] = 7;
  }
  holes() {
    this.elements.length = 0; this.elements[1] = 1; this.elements[15] = 2.5;
  }
  shorter() {
    this.elements.length = 6;
  }
  short() {
    this.elements.length = 2;
  }
  empty() {
    this.elements.length = 0;
  }
  longer() {
    this.elements.push(17, 18, 19);
  }
  notANumber() {
    this.elements[1] = NaN;
  }
  minus() {
    this.elements[0] = -0;
  }
  whole() {
    for (let i = 0; i < this.elements.length; i++) this.elements[i] = i;
  }
  fraction() {
    this.elements[3] = 0.25 * n;
  }
  beyond() {
    this.elements[1] = 4294967296 * n;
  }
  far() {
    this.elements[100000] = 1;
  }
  farHole() {
    this.elements.length = 100001;
  }
  replaced() {
    this.elements = [0.5, 1, 1.5, 2];
  }
  text() {
    let text = this.elements.length + ":";
    for (let i = 0; i < Math.min(this.elements.length, 20); i++) text += (this.elements[i] === 0 ? String(1 / this.elements[i]) : this.elements[i]) + ",";
    return text;
  }
  changeBy(by) {
    if (by === 1) this.elements[1] = 2.5;
    if (by === 2) this.elements.length = 2;
    if (by === 5) { this.elements.length = 1; this.elements[5] = 2; }
  }
  applyOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]); out.push((e[0] * x + e[4] * y + e[8] * z + e[12]) * w, (e[1] * x + e[5] * y + e[9] * z + e[13]) * w, (e[2] * x + e[6] * y + e[10] * z + e[14]) * w);
    return undefined;
  }
  determinantOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    const a = e[0], b = e[1], c = e[2], d = e[3], f = e[4], g = e[5], h = e[6], i = e[7], j = e[8]; out.push(a * f * j - a * g * i - b * d * j + b * g * h + c * d * i - c * f * h + x);
    return undefined;
  }
  sumsOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    out.push(e[0] + e[1] + e[2] + e[3]); out.push(e[4] - e[5] - e[6]); out.push(e[1] + x + e[2] + y);
    return undefined;
  }
  bitsOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    out.push((e[0] | 0) + (e[1] ^ e[2]) + (e[3] & 255), e[4] >> 1, e[5] < e[6], e[0] === e[1]);
    return undefined;
  }
  storesOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    const s = e[0] * e[1] + e[2] * e[3]; e[0] = s; e[1] = e[0] + e[2] + e[3]; e[2] = e[1] * e[0] * e[3]; out.push(s);
    return undefined;
  }
  twoListsOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    out.push(e[0] * t[0] + e[1] * t[4] + e[2] * t[8], e[4] * t[1] + e[5] * t[5] + e[6] * t[9]);
    return undefined;
  }
  farOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    out.push(e[0] + e[1] + e[15] + e[40000], e[2] * e[3] * e[65535]);
    return undefined;
  }
  calledOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    out.push(e[0] + e[1]); other.changeBy(x); out.push(e[0] + e[1] + e[2] + e[3]); other.changeBy(y); out.push(e[1] * e[2] * e[3]);
    return undefined;
  }
  branchesOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    if (x > 1) out.push(e[0] + e[1] + e[2]); else out.push(e[3] + e[4] + e[5]); out.push(x > 2 ? e[6] * e[7] * e[8] : e[0]);
    return undefined;
  }
  returnedOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    return e[0] * x + e[1] * y + e[2] * z + e[3];
    return undefined;
  }
  betweenOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    this.a = e[0] * x; this.b = e[1] + e[2] + this.a; other.hole(); this.a = e[2] * e[3] + e[4]; out.push(this.a, this.b, e[0] + e[1] + e[2]);
    return undefined;
  }
  slotsOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    this.a = e[0] * x + e[1] * y; this.b = e[2] * x + e[3] * y; this.c = e[4] * z + e[5] * this.a; out.push(this.a, this.b, this.c);
    return undefined;
  }
  growingOf(x, y, z, other, out) {
    const e = this.elements, t = other.elements;
    out.push(e[16] + e[17] + e[18], e[15] * e[14] * e[13]);
    return undefined;
  }
  change(kind) {
    switch (kind) {
      case "none":
        return this.none();
      case "hole":
        return this.hole();
      case "holes":
        return this.holes();
      case "shorter":
        return this.shorter();
      case "short":
        return this.short();
      case "empty":
        return this.empty();
      case "longer":
        return this.longer();
      case "notANumber":
        return this.notANumber();
      case "minus":
        return this.minus();
      case "whole":
        return this.whole();
      case "fraction":
        return this.fraction();
      case "beyond":
        return this.beyond();
      case "far":
        return this.far();
      case "farHole":
        return this.farHole();
      case "replaced":
        return this.replaced();
    }
  }
  run(form, x, y, z, other, out) {
    switch (form) {
      case "apply":
        return this.applyOf(x, y, z, other, out);
      case "determinant":
        return this.determinantOf(x, y, z, other, out);
      case "sums":
        return this.sumsOf(x, y, z, other, out);
      case "bits":
        return this.bitsOf(x, y, z, other, out);
      case "stores":
        return this.storesOf(x, y, z, other, out);
      case "twoLists":
        return this.twoListsOf(x, y, z, other, out);
      case "far":
        return this.farOf(x, y, z, other, out);
      case "called":
        return this.calledOf(x, y, z, other, out);
      case "branches":
        return this.branchesOf(x, y, z, other, out);
      case "returned":
        return this.returnedOf(x, y, z, other, out);
      case "between":
        return this.betweenOf(x, y, z, other, out);
      case "slots":
        return this.slotsOf(x, y, z, other, out);
      case "growing":
        return this.growingOf(x, y, z, other, out);
    }
  }
}
function tryDoubles(form, change, place, x, y, z) {
  const made = new Doubles(), other = place === "itself" ? made : new Doubles(), out = [];
  if (place !== "other") made.change(change);
  else other.change(change);
  let end = "", given;
  seen = 0;
  try {
    given = made.run(form, x, y, z, other, out);
  } catch (error) {
    end = " " + error.name;
  }
  log.push("Doubles " + form + " " + change + " " + place + end + " " + show(given) + " " + show(out) + " | " + made.text() + " | " + other.text() + " | " + show(made.a) + " " + show(made.b) + " " + show(made.c) + " " + seen);
}
function tryInts(form, change, place, x, y, z) {
  const made = new Ints(), other = place === "itself" ? made : new Ints(), out = [];
  if (place !== "other") made.change(change);
  else other.change(change);
  let end = "", given;
  seen = 0;
  try {
    given = made.run(form, x, y, z, other, out);
  } catch (error) {
    end = " " + error.name;
  }
  log.push("Ints " + form + " " + change + " " + place + end + " " + show(given) + " " + show(out) + " | " + made.text() + " | " + other.text() + " | " + show(made.a) + " " + show(made.b) + " " + show(made.c) + " " + seen);
}
function tryMixed(form, change, place, x, y, z) {
  const made = new Mixed(), other = place === "itself" ? made : new Mixed(), out = [];
  if (place !== "other") made.change(change);
  else other.change(change);
  let end = "", given;
  seen = 0;
  try {
    given = made.run(form, x, y, z, other, out);
  } catch (error) {
    end = " " + error.name;
  }
  log.push("Mixed " + form + " " + change + " " + place + end + " " + show(given) + " " + show(out) + " | " + made.text() + " | " + other.text() + " | " + show(made.a) + " " + show(made.b) + " " + show(made.c) + " " + seen);
}
function tryHoles(form, change, place, x, y, z) {
  const made = new Holes(), other = place === "itself" ? made : new Holes(), out = [];
  if (place !== "other") made.change(change);
  else other.change(change);
  let end = "", given;
  seen = 0;
  try {
    given = made.run(form, x, y, z, other, out);
  } catch (error) {
    end = " " + error.name;
  }
  log.push("Holes " + form + " " + change + " " + place + end + " " + show(given) + " " + show(out) + " | " + made.text() + " | " + other.text() + " | " + show(made.a) + " " + show(made.b) + " " + show(made.c) + " " + seen);
}
const operands = [[1, 2, 3], [0.5, -0, n], [2, 4, { valueOf() { seen += 7; return 2; } }], [5, "2", 1], [n, undefined, 3], [1, 2, 10n], [5, { valueOf() { seen++; throw new RangeError("no"); } }, 2]];
const forms = ["apply", "determinant", "sums", "bits", "stores", "twoLists", "far", "called", "branches", "returned", "between", "slots", "growing"];
const changes = ["none", "hole", "holes", "shorter", "short", "empty", "longer", "notANumber", "minus", "whole", "fraction", "beyond", "far", "farHole", "replaced"];
for (const [x, y, z] of operands) for (const form of forms) for (const change of changes) for (const place of ["made", "other", "itself"]) {
      if (numberOfCase++ % 5) continue;
      tryDoubles(form, change, place, x, y, z);
      tryInts(form, change, place, x, y, z);
      tryMixed(form, change, place, x, y, z);
      tryHoles(form, change, place, x, y, z);
}
let sum = 0;
for (const line of log) for (let i = 0; i < line.length; i++) sum = (sum * 31 + line.charCodeAt(i)) | 0;
console.log(log.length, sum);
for (let i = 0; i < log.length; i += 11) console.log(log[i]);
