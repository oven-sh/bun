// Matrices and vectors over typed arrays: products, decompositions, systems, eigenvalues, least squares, sparse matrices, complex numbers, polynomials, integration, statistics
class ShapeError extends RangeError {
  constructor(what: string, a: string, b: string) {
    super(`${what}: ${a} and ${b}`);
    this.name = "ShapeError";
  }
}
class Singular extends Error {
  constructor(readonly column: number) {
    super("singular at column " + column);
    this.name = "Singular";
  }
}
class Vector implements Iterable<number> {
  readonly data: Float64Array;
  constructor(data: ArrayLike<number> | number) {
    this.data = typeof data === "number" ? new Float64Array(data) : Float64Array.from(data as ArrayLike<number>);
  }
  get size() {
    return this.data.length;
  }
  *[Symbol.iterator]() {
    yield* this.data;
  }
  static from(n: number, f: (i: number) => number) {
    const v = new Vector(n);
    for (let i = 0; i < n; i++) v.data[i] = f(i);
    return v;
  }
  #same(o: Vector) {
    if (o.size !== this.size) throw new ShapeError("vectors", String(this.size),
      String(o.size));
  }
  plus(o: Vector) {
    this.#same(o);
    return Vector.from(this.size, i => this.data[i] + o.data[i]);
  }
  minus(o: Vector) {
    this.#same(o);
    return Vector.from(this.size, i => this.data[i] - o.data[i]);
  }
  times(k: number) {
    return Vector.from(this.size, i => this.data[i] * k);
  }
  dot(o: Vector) {
    this.#same(o);
    let s = 0;
    for (let i = 0; i < this.size; i++) s += this.data[i] * o.data[i];
    return s;
  }
  get norm() {
    return Math.sqrt(this.dot(this));
  }
  toString() {
    return "(" + [...this].map(x => +x.toFixed(4)).join(" ") + ")";
  }
}
abstract class Linear {
  abstract readonly rows: number;
  abstract readonly columns: number;
  abstract apply(v: Vector): Vector;
  get shape() {
    return `${this.rows}x${this.columns}`;
  }
  power(rounds: number, start?: Vector): {
    value: number;
    vector: Vector;
    rounds: number
  }
  {
    let v = start ?? Vector.from(this.columns, i => 1 + i / 10), value = 0;
    v = v.times(1 / v.norm);
    for (let i = 1; i <= rounds; i++) {
      const w = this.apply(v), n = w.norm;
      const next = w.times(1 / n);
      const change = Math.min(next.minus(v).norm, next.plus(v).norm);
      v = next;
      value = v.dot(this.apply(v));
      if (change < 1e-12) return {
        value, vector: v, rounds: i
    };
    }
    return {
      value, vector: v, rounds
  };
  }
  conjugate(b: Vector, limit = 200): {
    x: Vector;
    rounds: number;
    error: number
  }
  {
    let x = new Vector(this.columns), r = b.minus(this.apply(x)), p = r, rr = r.dot(r);
    for (let i = 1; i <= limit; i++) {
      const ap = this.apply(p), a = rr / p.dot(ap);
      x = x.plus(p.times(a));
      r = r.minus(ap.times(a));
      const next = r.dot(r);
      if (next < 1e-18) return {
        x, rounds: i, error: Math.sqrt(next)
    };
      p = r.plus(p.times(next / rr));
      rr = next;
    }
    return {
      x, rounds: limit, error: Math.sqrt(rr)
  };
  }
}
class Matrix extends Linear {
  readonly data: Float64Array;
  constructor(readonly rows: number, readonly columns: number, data?: ArrayLike<number>) {
    super();
    this.data = data ? Float64Array.from(data) : new Float64Array(rows * columns);
    if (this.data.length !== rows * columns) throw new ShapeError("data", `${rows}x${columns}`,
      String(this.data.length));
  }
  static from(rows: number, columns: number, f: (y: number, x: number) => number) {
    const m = new Matrix(rows, columns);
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) m.data[y * columns + x] = f(y,
      x);
    return m;
  }
  static identity(n: number) {
    return Matrix.from(n, n, (y, x) => (x === y ? 1 : 0));
  }
  at(y: number, x: number) {
    return this.data[y * this.columns + x];
  }
  set(y: number, x: number, v: number) {
    this.data[y * this.columns + x] = v;
  }
  copy() {
    return new Matrix(this.rows, this.columns, this.data);
  }
  get transposed() {
    return Matrix.from(this.columns, this.rows, (y, x) => this.at(x, y));
  }
  plus(o: Matrix) {
    if (o.shape !== this.shape) throw new ShapeError("sum", this.shape, o.shape);
    return Matrix.from(this.rows, this.columns, (y, x) => this.at(y, x) + o.at(y, x));
  }
  scale(k: number) {
    return Matrix.from(this.rows, this.columns, (y, x) => this.at(y, x) * k);
  }
  times(o: Matrix): Matrix {
    if (this.columns !== o.rows) throw new ShapeError("product", this.shape, o.shape);
    const out = new Matrix(this.rows, o.columns);
    for (let y = 0; y < this.rows; y++) for (let k = 0; k < this.columns; k++) {
      const v = this.data[y * this.columns + k];
      if (v === 0) continue;
      for (let x = 0; x < o.columns; x++) out.data[y * o.columns + x] += v * o.data[k * o.columns + x];
    }
    return out;
  }
  apply(v: Vector): Vector {
    if (v.size !== this.columns) throw new ShapeError("apply", this.shape, String(v.size));
    const out = new Vector(this.rows);
    for (let y = 0; y < this.rows; y++) {
      let s = 0;
      for (let x = 0; x < this.columns; x++) s += this.data[y * this.columns + x] * v.data[x];
      out.data[y] = s;
    }
    return out;
  }
  lu(): {
    lower: Matrix;
    upper: Matrix;
    order: number[];
    sign: number
  }
  {
    const n = this.rows, u = this.copy(), l = Matrix.identity(n),
      order = Array.from({ length: n }, (_, i) => i);
    let sign = 1;
    for (let k = 0; k < n; k++) {
      let p = k;
      for (let y = k + 1; y < n; y++) if (Math.abs(u.at(y, k)) > Math.abs(u.at(p, k))) p = y;
      if (Math.abs(u.at(p, k)) < 1e-12) throw new Singular(k);
      if (p !== k) {
        sign = -sign;
        [order[k], order[p]] = [order[p], order[k]];
        for (let x = 0; x < n; x++) {
          const a = u.at(k, x);
          u.set(k, x, u.at(p, x));
          u.set(p, x, a);
          if (x < k) {
            const b = l.at(k, x);
            l.set(k, x, l.at(p, x));
            l.set(p, x, b);
          }
        }
      }
      for (let y = k + 1; y < n; y++) {
        const f = u.at(y, k) / u.at(k, k);
        l.set(y, k, f);
        for (let x = k; x < n; x++) u.set(y, x, u.at(y, x) - f * u.at(k, x));
      }
    }
    return {
      lower: l, upper: u, order, sign
  };
  }
  solve(b: Vector): Vector {
    const {
      lower, upper, order
  } = this.lu(), n = this.rows, y = new Vector(n), x = new Vector(n);
    for (let i = 0; i < n; i++) {
      let s = b.data[order[i]];
      for (let k = 0; k < i; k++) s -= lower.at(i, k) * y.data[k];
      y.data[i] = s;
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = y.data[i];
      for (let k = i + 1; k < n; k++) s -= upper.at(i, k) * x.data[k];
      x.data[i] = s / upper.at(i, i);
    }
    return x;
  }
  get determinant() {
    try {
      const {
        upper, sign
    } = this.lu();
      let d = sign;
      for (let i = 0; i < this.rows; i++) d *= upper.at(i, i);
      return d;
  } catch (e) {
      if (e instanceof Singular) return 0;
      throw e;
    }
  }
  get inverse() {
    const n = this.rows;
    const columns = Array.from({ length: n }, (_, k) => this.solve(Vector.from(n,
      i => (i === k ? 1 : 0))));
    return Matrix.from(n, n, (y, x) => columns[x].data[y]);
  }
  qr(): {
    q: Matrix;
    r: Matrix
  }
  {
    const q = new Matrix(this.rows, this.columns), r = new Matrix(this.columns, this.columns);
    for (let k = 0; k < this.columns; k++) {
      let v = Vector.from(this.rows, y => this.at(y, k));
      for (let j = 0; j < k; j++) {
        const u = Vector.from(this.rows, y => q.at(y, j));
        const d = u.dot(v);
        r.set(j, k, d);
        v = v.minus(u.times(d));
      }
      const n = v.norm;
      r.set(k, k, n);
      for (let y = 0; y < this.rows; y++) q.set(y, k, n ? v.data[y] / n : 0);
    }
    return {
      q, r
  };
  }
  eigenvalues(rounds = 120): number[] {
    let a: Matrix = this.copy();
    for (let i = 0; i < rounds; i++) {
      const {
        q, r
    } = a.qr();
      a = r.times(q);
    }
    return Array.from({ length: this.rows }, (_, i) => a.at(i, i)).sort((x, y) => y - x);
  }
  leastSquares(b: Vector): Vector {
    const t = this.transposed;
    return t.times(this).solve(t.apply(b));
  }
  cholesky(): Matrix {
    const n = this.rows, l = new Matrix(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x <= y; x++) {
      let s = this.at(y, x);
      for (let k = 0; k < x; k++) s -= l.at(y, k) * l.at(x, k);
      if (x === y) {
        if (s <= 0) throw new Singular(y);
        l.set(y, x, Math.sqrt(s));
    } else l.set(y, x, s / l.at(x, x));
    }
    return l;
  }
  get norm() {
    return Math.sqrt(this.data.reduce((s, v) => s + v * v, 0));
  }
  toString() {
    return Array.from({ length: this.rows }, (_, y) => Array.from({ length: this.columns }, (_,
      x) => +this.at(y, x).toFixed(3)).join(" ")).join(" / ");
  }
}
class Sparse extends Linear {
  readonly #starts: number[] = [0];
  readonly #columns: number[] = [];
  readonly #values: number[] = [];
  constructor(readonly rows: number, readonly columns: number,
    entries: Iterable<readonly [number, number, number]>) {
    super();
    const sorted = [...entries].filter(e => e[2] !== 0).sort((a, b) => a[0] - b[0] ||
      a[1] - b[1]);
    let row = 0;
    for (const [y, x, v] of sorted) {
      while (row < y) {
        this.#starts.push(this.#columns.length);
        row++;
      }
      if (this.#columns.length > this.#starts[row] &&
        this.#columns.at(-1) === x) this.#values[this.#values.length - 1] += v;
      else {
        this.#columns.push(x);
        this.#values.push(v);
      }
  } while (this.#starts.length <= rows) this.#starts.push(this.#columns.length);
  }
  get count() {
    return this.#values.length;
  }
  apply(v: Vector): Vector {
    const out = new Vector(this.rows);
    for (let y = 0; y < this.rows; y++) {
      let s = 0;
      for (let i = this.#starts[y]; i < this.#starts[y + 1]; i++) s += this.#values[i] * v.data[this.#columns[i]];
      out.data[y] = s;
    }
    return out;
  }
  dense() {
    const m = new Matrix(this.rows, this.columns);
    for (let y = 0; y < this.rows; y++) for (let i = this.#starts[y]; i < this.#starts[y + 1]; i++) m.set(y,
      this.#columns[i], this.#values[i]);
    return m;
  }
}
class Complex {
  constructor(readonly re: number, readonly im = 0) {
  }
  add(o: Complex) {
    return new Complex(this.re + o.re, this.im + o.im);
  }
  sub(o: Complex) {
    return new Complex(this.re - o.re, this.im - o.im);
  }
  mul(o: Complex) {
    return new Complex(this.re * o.re - this.im * o.im, this.re * o.im + this.im * o.re);
  }
  div(o: Complex) {
    const d = o.re * o.re + o.im * o.im;
    return new Complex((this.re * o.re + this.im * o.im) / d,
      (this.im * o.re - this.re * o.im) / d);
  }
  get abs() {
    return Math.hypot(this.re, this.im);
  }
  toString() {
    return `${+this.re.toFixed(4)}${this.im < 0 ? "-" : "+"}${Math.abs(+this.im.toFixed(4))}i`;
  }
}
class Polynomial {
  constructor(readonly c: readonly number[]) {
  }
  at(x: Complex): Complex {
    let r = new Complex(0);
    for (let i = this.c.length - 1; i >= 0; i--) r = r.mul(x).add(new Complex(this.c[i]));
    return r;
  }
  get derivative() {
    return new Polynomial(this.c.slice(1).map((v, i) => v * (i + 1)));
  }
  times(o: Polynomial) {
    const out = new Array(this.c.length + o.c.length - 1).fill(0);
    this.c.forEach((a, i) => o.c.forEach((b, k) => {
      out[i + k] += a * b;
  }));
    return new Polynomial(out);
  }
  roots(rounds = 200): Complex[] {
    const n = this.c.length - 1;
    let z = Array.from({ length: n }, (_, i) => {
      let p = new Complex(1);
      for (let k = 0; k < i; k++) p = p.mul(new Complex(0.4, 0.9));
      return p;
  });
    for (let r = 0; r < rounds; r++) z = z.map((x, i) => {
      let d = new Complex(this.c[n]);
      z.forEach((y, k) => {
        if (k !== i) d = d.mul(x.sub(y));
    });
      return x.sub(this.at(x).div(d));
  });
    return z.sort((a, b) => +(a.re - b.re).toFixed(6) || a.im - b.im);
  }
}
namespace Numeric {
  export function integrate(f: (x: number) => number, a: number, b: number, n: number): number {
    const h = (b - a) / n;
    let s = f(a) + f(b);
    for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
    return (s * h) / 3;
  }
  export function solve(f: (x: number) => number, a: number, b: number): number {
    let lo = a, hi = b;
    if (f(lo) * f(hi) > 0) throw new RangeError("no change of sign");
    for (let i = 0; i < 80; i++) {
      const m = (lo + hi) / 2;
      if (f(lo) * f(m) <= 0) hi = m;
      else lo = m;
    }
    return (lo + hi) / 2;
  }
  export function* steps(f: (t: number, y: Vector) => Vector, y: Vector, dt: number,
    n: number): Generator<Vector> {
    let t = 0;
    for (let i = 0; i < n; i++) {
      const k1 = f(t, y), k2 = f(t + dt / 2, y.plus(k1.times(dt / 2))), k3 = f(t + dt / 2,
        y.plus(k2.times(dt / 2))), k4 = f(t + dt, y.plus(k3.times(dt)));
      y = y.plus(k1.plus(k2.times(2)).plus(k3.times(2)).plus(k4).times(dt / 6));
      t += dt;
      yield y;
    }
  }
  export const stats = (v: Iterable<number>) => {
    let n = 0, mean = 0, m2 = 0;
    for (const x of v) {
      n++;
      const d = x - mean;
      mean += d / n;
      m2 += d * (x - mean);
    }
    return {
      n, mean, deviation: n > 1 ? Math.sqrt(m2 / (n - 1)) : 0
  };
};
}
const a = new Matrix(3, 3, [4, -2, 1, -2, 4, -2, 1, -2, 4]);
console.log(String(a.times(a)), a.determinant.toFixed(3), String(a.inverse),
  String(a.solve(new Vector([11, -16, 17]))), a.eigenvalues().map(v => v.toFixed(4)).join(),
  String(a.cholesky()));
const {
  q, r
} = a.qr();
console.log(q.times(r).plus(a.scale(-1)).norm < 1e-9,
  q.transposed.times(q).plus(Matrix.identity(3).scale(-1)).norm < 1e-9);
const {
  lower, upper, order, sign
} = a.lu();
console.log(String(lower), String(upper), order.join(), sign);
let sum = 0;
for (const n of [5, 12, 30, 60]) {
  const m = Matrix.from(n, n, (y, x) => 1 / (1 + Math.abs(y - x)) + (y === x ? n / 4 : 0));
  const b = Vector.from(n, i => Math.sin(i + 1));
  const x = m.solve(b);
  const {
    value, rounds
} = m.power(500);
  const cg = m.conjugate(b);
  sum += x.norm + value;
  console.log(n, x.norm.toFixed(6), m.apply(x).minus(b).norm < 1e-9, value.toFixed(6), rounds,
    cg.rounds, cg.x.minus(x).norm < 1e-7, m.determinant.toExponential(4),
    n <= 12 ? m.eigenvalues(60).map(v => v.toFixed(2)).join() : "");
}
console.log(sum.toFixed(6));
const n = 900, laplace = new Sparse(n, n, (function* (): Generator<[number, number,
  number]> { for (let i = 0; i < n; i++) {
  yield [i, i, 4];
  const x = i % 30, y = (i / 30) | 0;
  if (x > 0) yield [i, i - 1, -1];
  if (x < 29) yield [i, i + 1, -1];
  if (y > 0) yield [i, i - 30, -1];
  if (y < 29) yield [i, i + 30, -1];
}
})());
const heat = laplace.conjugate(Vector.from(n, i => (i % 37 === 0 ? 1 : 0)), 300);
console.log(laplace.count, heat.rounds, heat.x.norm.toFixed(8),
  laplace.power(400).value.toFixed(5), laplace.dense().at(31, 1));
const fit = Matrix.from(50, 3, (y, x) => Math.pow(y / 10, x)).leastSquares(Vector.from(50,
  y => 2 - y / 10 + 0.5 * (y / 10) ** 2 + (y % 2 ? 0.01 : -0.01)));
console.log(String(fit));
console.log(new Polynomial([-6, 11, -6, 1]).roots().join(" "), new Polynomial([1, 0,
  1]).roots().join(" "), new Polynomial([1, 1]).times(new Polynomial([-1, 1])).c.join(),
  new Polynomial([5, 4, 3]).derivative.c.join());
console.log(Numeric.integrate(Math.sin, 0, Math.PI, 20000).toFixed(9),
  Numeric.solve(x => x * x - 2, 0, 2).toFixed(9));
let last = new Vector([1, 0]), count = 0, energy = 0;
for (const y of Numeric.steps((_, y) => new Vector([y.data[1], -y.data[0]]), last, 0.01,
  6000)) {
  last = y;
  count++;
  energy = y.dot(y);
}
console.log(String(last), count, energy.toFixed(9));
const s = Numeric.stats(Array.from({ length: 20000 }, (_, i) => Math.sin(i) * (i % 3)));
console.log(s.n, s.mean.toFixed(8), s.deviation.toFixed(8));
for (const bad of [() => a.times(new Matrix(2, 2)), () => new Matrix(2, 2, [1, 2, 2,
  4]).solve(new Vector(2)), () => new Vector([1]).plus(new Vector([1, 2])), () => new Matrix(2,
  2, [1]), () => Numeric.solve(x => x * x + 1, 0, 1), () => new Matrix(2, 2, [1, 2, 2,
  1]).cholesky()]) try {
  bad();
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}
console.log(new Matrix(2, 2, [1, 2, 2, 4]).determinant);
