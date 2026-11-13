// An element that nothing shows inside its view and that only arithmetic takes is read as a double: what lies outside is NaN at once.
// STATISTIC: ViewIntegersReadAsDoubles >= 7
class LifeUint8Array {
  cells = new Uint8Array(20);
  constructor(readonly width: number, readonly height: number) { for (let i = 0; i < 20; i++) this.cells[i] = i * 37 - 5; }
  around(x: number, y: number): number { const c = this.cells, w = this.width, h = this.height; let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (dx === 0 && dy === 0) continue; n += c[((y + dy + h) % h) * w + ((x + dx + w) % w)]!; } return n; }
  outside(from: number, by: number): string { let sum = 0, product = 1, less = 0, quotient = 0; for (let k = -3; k < 24; k += by) { const at = from + k * 1.5; product = 7 * this.cells[at]!; quotient = this.cells[at * 2]! / 3; sum += this.cells[at]! - 1; if (this.cells[at + 1]! < 50) less++; } return sum + " " + product + " " + quotient + " " + less; }
  text(from: number): string { let t = ""; for (let k = -2; k < 3; k++) t += this.cells[from + k]! + ","; return t; }
}
class LifeInt8Array {
  cells = new Int8Array(20);
  constructor(readonly width: number, readonly height: number) { for (let i = 0; i < 20; i++) this.cells[i] = i * 37 - 5; }
  around(x: number, y: number): number { const c = this.cells, w = this.width, h = this.height; let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (dx === 0 && dy === 0) continue; n += c[((y + dy + h) % h) * w + ((x + dx + w) % w)]!; } return n; }
  outside(from: number, by: number): string { let sum = 0, product = 1, less = 0, quotient = 0; for (let k = -3; k < 24; k += by) { const at = from + k * 1.5; product = 7 * this.cells[at]!; quotient = this.cells[at * 2]! / 3; sum += this.cells[at]! - 1; if (this.cells[at + 1]! < 50) less++; } return sum + " " + product + " " + quotient + " " + less; }
  text(from: number): string { let t = ""; for (let k = -2; k < 3; k++) t += this.cells[from + k]! + ","; return t; }
}
class LifeUint8ClampedArray {
  cells = new Uint8ClampedArray(20);
  constructor(readonly width: number, readonly height: number) { for (let i = 0; i < 20; i++) this.cells[i] = i * 37 - 5; }
  around(x: number, y: number): number { const c = this.cells, w = this.width, h = this.height; let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (dx === 0 && dy === 0) continue; n += c[((y + dy + h) % h) * w + ((x + dx + w) % w)]!; } return n; }
  outside(from: number, by: number): string { let sum = 0, product = 1, less = 0, quotient = 0; for (let k = -3; k < 24; k += by) { const at = from + k * 1.5; product = 7 * this.cells[at]!; quotient = this.cells[at * 2]! / 3; sum += this.cells[at]! - 1; if (this.cells[at + 1]! < 50) less++; } return sum + " " + product + " " + quotient + " " + less; }
  text(from: number): string { let t = ""; for (let k = -2; k < 3; k++) t += this.cells[from + k]! + ","; return t; }
}
class LifeUint16Array {
  cells = new Uint16Array(20);
  constructor(readonly width: number, readonly height: number) { for (let i = 0; i < 20; i++) this.cells[i] = i * 37 - 5; }
  around(x: number, y: number): number { const c = this.cells, w = this.width, h = this.height; let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (dx === 0 && dy === 0) continue; n += c[((y + dy + h) % h) * w + ((x + dx + w) % w)]!; } return n; }
  outside(from: number, by: number): string { let sum = 0, product = 1, less = 0, quotient = 0; for (let k = -3; k < 24; k += by) { const at = from + k * 1.5; product = 7 * this.cells[at]!; quotient = this.cells[at * 2]! / 3; sum += this.cells[at]! - 1; if (this.cells[at + 1]! < 50) less++; } return sum + " " + product + " " + quotient + " " + less; }
  text(from: number): string { let t = ""; for (let k = -2; k < 3; k++) t += this.cells[from + k]! + ","; return t; }
}
class LifeInt16Array {
  cells = new Int16Array(20);
  constructor(readonly width: number, readonly height: number) { for (let i = 0; i < 20; i++) this.cells[i] = i * 37 - 5; }
  around(x: number, y: number): number { const c = this.cells, w = this.width, h = this.height; let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (dx === 0 && dy === 0) continue; n += c[((y + dy + h) % h) * w + ((x + dx + w) % w)]!; } return n; }
  outside(from: number, by: number): string { let sum = 0, product = 1, less = 0, quotient = 0; for (let k = -3; k < 24; k += by) { const at = from + k * 1.5; product = 7 * this.cells[at]!; quotient = this.cells[at * 2]! / 3; sum += this.cells[at]! - 1; if (this.cells[at + 1]! < 50) less++; } return sum + " " + product + " " + quotient + " " + less; }
  text(from: number): string { let t = ""; for (let k = -2; k < 3; k++) t += this.cells[from + k]! + ","; return t; }
}
class LifeUint32Array {
  cells = new Uint32Array(20);
  constructor(readonly width: number, readonly height: number) { for (let i = 0; i < 20; i++) this.cells[i] = i * 37 - 5; }
  around(x: number, y: number): number { const c = this.cells, w = this.width, h = this.height; let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (dx === 0 && dy === 0) continue; n += c[((y + dy + h) % h) * w + ((x + dx + w) % w)]!; } return n; }
  outside(from: number, by: number): string { let sum = 0, product = 1, less = 0, quotient = 0; for (let k = -3; k < 24; k += by) { const at = from + k * 1.5; product = 7 * this.cells[at]!; quotient = this.cells[at * 2]! / 3; sum += this.cells[at]! - 1; if (this.cells[at + 1]! < 50) less++; } return sum + " " + product + " " + quotient + " " + less; }
  text(from: number): string { let t = ""; for (let k = -2; k < 3; k++) t += this.cells[from + k]! + ","; return t; }
}
class LifeInt32Array {
  cells = new Int32Array(20);
  constructor(readonly width: number, readonly height: number) { for (let i = 0; i < 20; i++) this.cells[i] = i * 37 - 5; }
  around(x: number, y: number): number { const c = this.cells, w = this.width, h = this.height; let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (dx === 0 && dy === 0) continue; n += c[((y + dy + h) % h) * w + ((x + dx + w) % w)]!; } return n; }
  outside(from: number, by: number): string { let sum = 0, product = 1, less = 0, quotient = 0; for (let k = -3; k < 24; k += by) { const at = from + k * 1.5; product = 7 * this.cells[at]!; quotient = this.cells[at * 2]! / 3; sum += this.cells[at]! - 1; if (this.cells[at + 1]! < 50) less++; } return sum + " " + product + " " + quotient + " " + less; }
  text(from: number): string { let t = ""; for (let k = -2; k < 3; k++) t += this.cells[from + k]! + ","; return t; }
}
for (const life of [new LifeUint8Array(5, 4), new LifeInt8Array(5, 4), new LifeUint8ClampedArray(5, 4), new LifeUint16Array(5, 4), new LifeInt16Array(5, 4), new LifeUint32Array(5, 4), new LifeInt32Array(5, 4)]) {
  let all = 0; for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) all = all * 3 % 1000003 + life.around(x, y);
  console.log(all, life.around(0, 9), life.around(0.5, 1), life.outside(0, 1), life.outside(3, 2), life.outside(-9, 3), life.outside(4, 5), life.text(0), life.text(19), life.text(1.5));
}
export {};
