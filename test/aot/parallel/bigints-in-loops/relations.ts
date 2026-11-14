// Relations, equality, arithmetic and bit operators of BigInts in loops: zero, one digit, several digits and either sign.
const values: bigint[] = [0n, 1n, -1n, 2n, -2n, 0xffffffffffffffffn, -0xffffffffffffffffn, 0x10000000000000000n, -0x10000000000000000n, 0x10000000000000001n, 0x8000000000000000n, -0x8000000000000000n, 0x7fffffffffffffffn, 2n ** 200n, -(2n ** 200n), 2n ** 200n + 1n, BigInt("0"), -0n, BigInt.asIntN(64, 2n ** 63n)];

function less(list: bigint[], b: bigint): string { let s = ""; for (const a of list) s += a < b ? "1" : "0"; return s; }
function lessOrEqual(list: bigint[], b: bigint): string { let s = ""; for (const a of list) s += a <= b ? "1" : "0"; return s; }
function greater(list: bigint[], b: bigint): string { let s = ""; for (const a of list) s += a > b ? "1" : "0"; return s; }
function greaterOrEqual(list: bigint[], b: bigint): string { let s = ""; for (const a of list) s += a >= b ? "1" : "0"; return s; }
function strictlyEqual(list: bigint[], b: bigint): string { let s = ""; for (const a of list) s += a === b ? "1" : "0"; return s; }
function strictlyUnequal(list: bigint[], b: bigint): string { let s = ""; for (const a of list) s += a !== b ? "1" : "0"; return s; }
function looselyEqual(list: bigint[], b: bigint): string { let s = ""; for (const a of list) s += a == b ? "1" : "0"; return s; }
function literals(list: bigint[]): string { let s = ""; for (const a of list) s += `${a === 0n ? 0 : 1}${a > 0n ? 1 : 0}${a < 1n ? 1 : 0}${a >= -1n ? 1 : 0}${(a & 1n) === 1n ? 1 : 0}${a !== 18446744073709551615n ? 1 : 0}`; return s; }
for (const b of values) console.log(String(b), less(values, b), lessOrEqual(values, b), greater(values, b), greaterOrEqual(values, b), strictlyEqual(values, b), strictlyUnequal(values, b), looselyEqual(values, b));
console.log(literals(values));

function operators(list: bigint[], b: bigint): string {
  const found: string[] = [];
  for (const a of list) {
    found.push(String(a + b), String(a - b), String(a * b), String(a & b), String(a | b), String(a ^ b));
    if (b !== 0n) found.push(String(a / b), String(a % b));
    if (b < 100n && b > -100n) found.push(String(a << b), String(a >> b));
  }
  return found.join(" ");
}
for (const b of values) console.log(operators(values, b));
function thrown(list: bigint[], b: bigint): string { let s = ""; for (const a of list) { try { s += a / b; } catch (e) { s += (e as Error).name[0]; } } return s; }
console.log(thrown(values, 0n));

function power(base: bigint, exponent: bigint, modulus: bigint): bigint { let result = 1n, b = base % modulus; for (let e = exponent; e > 0n; e >>= 1n) { if (e & 1n) result = (result * b) % modulus; b = (b * b) % modulus; } return result; }
function greatest(a: bigint, b: bigint): bigint { while (b !== 0n) { const rest = a % b; a = b; b = rest; } return a; }
function counted(limit: bigint): number { let count = 0; for (let k = -3n; k <= limit; k++) count++; for (let k = limit; k > -3n; k -= 2n) count += 100; return count; }
console.log(power(3n, 2n ** 70n + 5n, 1000000007n), power(12345678901234567890123n, 65537n, 2n ** 127n - 1n), greatest(2n ** 130n - 2n ** 64n, 2n ** 66n), greatest(0n, 7n), counted(20n), counted(-5n));
