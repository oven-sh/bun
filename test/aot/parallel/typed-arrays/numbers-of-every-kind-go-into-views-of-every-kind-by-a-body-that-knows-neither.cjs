// 1,589 numbers go into views of nine kinds through a function that knows neither the view, the position nor the value; each is held against the rule of the language, written out by hand; the neighbours stay 0.
// Of 42,903 stores those leave for the run time that no truncation through 64 bits can answer.
// COUNT: operation:operationAOTPutByVal <= 700
'use strict';
const z = JSON.parse('0'), any = x => [x][z], put = (v, i, x) => { v[i] = x; };
const V = [0, -0, 1, -1, 254, 255, 256, 300, -300, 65535, 65536, 2147483647, -2147483648]; for (let h = -3; h <= 515; h++) { V.push(h / 2, h / 2 + 1e-9, h / 2 - 1e-9); }
V.push(2147483648.5, 4294967295.5, 4294967296.5, -4294967297.5, 9007199254740993, 9223372036854774784, 9223372036854775808, -9223372036854775808, 18446744073709551616, 1e21, -1e21, 1e300, -1e300, 5e-324, NaN, Infinity, -Infinity, 0.1, 1 / 3);
const int = (x, bits, signed) => { if (!Number.isFinite(x)) return 0; const w = signed ? BigInt.asIntN(bits, BigInt(Math.trunc(x))) : BigInt.asUintN(bits, BigInt(Math.trunc(x))); return Number(w); };
const cut = x => { if (!(x > 0)) return 0; if (x >= 255) return 255; const w = Math.floor(x), d = x - w; return d < 0.5 ? w : d > 0.5 ? w + 1 : w + (w & 1); };
const K = [[Int8Array, x => int(x, 8, true)], [Uint8Array, x => int(x, 8, false)], [Uint8ClampedArray, cut], [Int16Array, x => int(x, 16, true)], [Uint16Array, x => int(x, 16, false)], [Int32Array, x => int(x, 32, true)], [Uint32Array, x => int(x, 32, false)], [Float32Array, x => Math.fround(x)], [Float64Array, x => x]];
const bad = []; for (const [C, rule] of K) { const v = new C(3); let n = 0; for (let r = 0; r < 3; r++) for (const x of V) { put(any(v), any(1), any(x)); if (!Object.is(v[1], rule(x)) || v[0] !== 0 || v[2] !== 0) n++; } bad.push(n); }
console.log(V.length, bad.join());
