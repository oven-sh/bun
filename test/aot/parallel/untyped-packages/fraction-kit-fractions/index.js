// exact fractions, big powers, primes and bases over BigInt; continued fractions and square roots
'use strict';
const abs = x => x < 0n ? -x : x, gcd = (a, b) => { a = abs(a); b = abs(b); while (b) [a, b] = [b, a % b]; return a; };
class Fraction {
  constructor(n, d = 1n) { if (typeof n === 'string') { const m = /^\s*([+-]?\d+)(?:\.(\d*))?(?:\((\d+)\))?(?:\s*\/\s*(\d+))?\s*$/.exec(n); if (!m) throw new SyntaxError('bad fraction ' + n); let num = BigInt(m[1]), den = 1n; const neg = m[1][0] === '-'; if (m[2]) { den = 10n ** BigInt(m[2].length); num = num * den + (neg ? -1n : 1n) * BigInt(m[2]); } if (m[3]) { const k = 10n ** BigInt(m[3].length) - 1n, base = den; num = num * k + (neg ? -1n : 1n) * BigInt(m[3]); den = base * k; } if (m[4]) den *= BigInt(m[4]); n = num; d = den * BigInt(d); } else if (typeof n === 'number') { if (!Number.isFinite(n)) throw new RangeError('not finite'); let den = 1; while (n % 1) { n *= 2; den *= 2; } n = BigInt(n); d = BigInt(d) * BigInt(den); } if (d === 0n) throw new RangeError('Division by zero'); if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d) || 1n; this.n = n / g; this.d = d / g; Object.freeze(this); }
  static of(x) { return x instanceof Fraction ? x : typeof x === 'bigint' ? new Fraction(x, 1n) : new Fraction(x); }
  add(o) { o = Fraction.of(o); return new Fraction(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { o = Fraction.of(o); return new Fraction(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { o = Fraction.of(o); return new Fraction(this.n * o.n, this.d * o.d); }
  div(o) { o = Fraction.of(o); return new Fraction(this.n * o.d, this.d * o.n); }
  pow(k) { return k < 0 ? new Fraction(this.d ** BigInt(-k), this.n ** BigInt(-k)) : new Fraction(this.n ** BigInt(k), this.d ** BigInt(k)); }
  cmp(o) { o = Fraction.of(o); const a = this.n * o.d, b = o.n * this.d; return a < b ? -1 : a > b ? 1 : 0; }
  floor() { let q = this.n / this.d; if (this.n % this.d < 0n) q -= 1n; return q; }
  continued(max = 20) { const out = []; let [n, d] = [this.n, this.d]; while (d && out.length < max) { let q = n / d; if (n % d < 0n) q -= 1n; out.push(q); [n, d] = [d, n - q * d]; } return out; }
  static convergents(list) { let [h0, h1, k0, k1] = [0n, 1n, 1n, 0n]; return list.map(a => { [h0, h1] = [h1, a * h1 + h0]; [k0, k1] = [k1, a * k1 + k0]; return new Fraction(h1, k1); }); }
  decimal(max = 30) { let out = this.n < 0n ? '-' : ''; let n = abs(this.n); out += n / this.d; let r = n % this.d; if (!r) return out; out += '.'; const seen = new Map(), digits = []; while (r && digits.length < max) { if (seen.has(r)) { const at = seen.get(r); return out + digits.slice(0, at).join('') + '(' + digits.slice(at).join('') + ')'; } seen.set(r, digits.length); r *= 10n; digits.push(r / this.d); r %= this.d; } return out + digits.join('') + (r ? '...' : ''); }
  valueOf() { return Number(this.n) / Number(this.d); }
  toString() { return this.d === 1n ? String(this.n) : this.n + '/' + this.d; }
  toJSON() { return { n: String(this.n), d: String(this.d) }; }
}
const modpow = (b, e, m) => { let r = 1n; b = ((b % m) + m) % m; while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; };
const inverse = (a, m) => { let [r0, r1, s0, s1] = [m, ((a % m) + m) % m, 0n, 1n]; while (r1) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; } if (r0 !== 1n) throw new RangeError(a + ' has no inverse modulo ' + m); return ((s0 % m) + m) % m; };
const isPrime = n => { if (n < 2n) return false; for (const p of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]) { if (n === p) return true; if (n % p === 0n) return false; } let d = n - 1n, s = 0; while (!(d & 1n)) { d >>= 1n; s++; } next: for (const a of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]) { let x = modpow(a, d, n); if (x === 1n || x === n - 1n) continue; for (let i = 1; i < s; i++) { x = x * x % n; if (x === n - 1n) continue next; } return false; } return true; };
const isqrt = n => { if (n < 0n) throw new RangeError('negative'); if (n < 2n) return n; let x = 1n << BigInt((n.toString(2).length + 1) >> 1); for (;;) { const y = (x + n / x) >> 1n; if (y >= x) return x; x = y; } };
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; const toBase = (n, alphabet = B58) => { const b = BigInt(alphabet.length); let s = ''; do { s = alphabet[Number(n % b)] + s; n /= b; } while (n); return s; }; const fromBase = (s, alphabet = B58) => [...s].reduce((n, c) => { const i = alphabet.indexOf(c); if (i < 0) throw new RangeError('bad digit ' + c); return n * BigInt(alphabet.length) + BigInt(i); }, 0n);
const pi = digits => { const unity = 10n ** BigInt(digits + 10); const arctan = x => { let sum = unity / x, term = sum, n = 3n, sign = -1n; const x2 = x * x; while (term) { term /= x2; sum += sign * (term / n); sign = -sign; n += 2n; } return sum; }; return String((4n * (4n * arctan(5n) - arctan(239n))) / 10n ** 10n); };
module.exports = { Fraction, gcd, modpow, inverse, isPrime, isqrt, toBase, fromBase, pi };
