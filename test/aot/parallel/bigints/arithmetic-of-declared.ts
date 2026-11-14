// The same operations where the operands are declared and proven BigInts, outside loops and in loops.
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=40
// Env of the executable: BUN_JSC_useZombieMode=1
const P: bigint = (1n << 255n) - 19n;
const zero: bigint = BigInt(0), one: bigint = BigInt(1);

function mod(a: bigint, b: bigint = P): bigint {
  const result = a % b;
  return result >= zero ? result : b + result;
}

class Point {
  constructor(readonly x: bigint, readonly y: bigint, readonly z: bigint, readonly t: bigint) {}
  add(other: Point): Point {
    const A = mod((this.y - this.x) * (other.y + other.x)), B = mod((this.y + this.x) * (other.y - other.x)), F = mod(B - A);
    if (F === zero) return this.double();
    const C = mod(this.z * 2n * other.t), D = mod(this.t * 2n * other.z), E = D + C, G = B + A, H = D - C;
    return new Point(mod(E * F), mod(G * H), mod(F * G), mod(E * H));
  }
  double(): Point {
    const A = mod(this.x * this.x), B = mod(this.y * this.y), C = mod(2n * mod(this.z * this.z)), D = mod(-one * A), sum = this.x + this.y;
    const E = mod(mod(sum * sum) - A - B), G = D + B, F = G - C, H = D - B;
    return new Point(mod(E * F), mod(G * H), mod(F * G), mod(E * H));
  }
  toString(): string { return [this.x, this.y, this.z, this.t].map(value => value.toString(16)).join(","); }
}

const Gx = 15112221349535400772501151409588531511454012693041857206046113283949847762202n, Gy = 46316835694926478169428394003475163141307993866256225615783033603165251855960n;
const base = new Point(Gx, Gy, one, mod(Gx * Gy));
let sum = base, doubled = base;
for (let i = 0; i < 200; i++) {
  doubled = doubled.double();
  sum = i % 3 ? sum.add(doubled) : doubled.add(sum);
}
console.log(String(sum));
console.log(String(base.add(base)), String(base.double()));

function power(value: bigint, exponent: bigint): bigint {
  let result = one, factor = value;
  while (exponent > zero) {
    if (exponent & one) result = (result * factor) % P;
    factor *= factor;
    factor %= P;
    exponent >>= one;
  }
  return result;
}
console.log(power(Gx, P - 2n).toString(16), mod(power(Gx, P - 2n) * Gx));

function digits(value: bigint): number {
  let count = 0;
  while (value !== zero) { value = value / 10n; count++; }
  return count;
}
console.log(digits(Gx * Gy * Gx), digits(-Gx), digits(zero));

let fibonacci: [bigint, bigint] = [zero, one];
for (let i = 0; i < 3000; i++) fibonacci = [fibonacci[1], fibonacci[0] + fibonacci[1]];
console.log(fibonacci[0].toString(16).slice(0, 60), (fibonacci[1] - fibonacci[0]).toString(16).slice(-60));
