// Every caller hands the same divisor: its type is one integer, though no constant stands at the remainder.
function power(base: number, exponent: number, size: number): number { let result = 1; base = base % size; while (exponent > 0) { if (exponent & 1) result = result * base % size; base = base * base % size; exponent = exponent >> 1; } return result; }
function sum(turns: number): number { let all = 0; for (let i = 0; i < turns; i++) all = (all + power(i + 3, 1023, 65521)) | 0; return all; }
console.log(sum(0), sum(1), sum(40), power(65520, 2, 65521), power(-3, 3, 65521), power(0.5, 2, 65521), power(2 ** 40, 3, 65521));
