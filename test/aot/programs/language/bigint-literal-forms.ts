// BigInt literals in decimal, hexadecimal, octal and binary notation, with separators and of any length, and what BigInt() parses at run time.
export {};

const zero = 0n;
console.log("zero:", zero.toString(), typeof zero, zero ? "truthy" : "falsy", (-zero).toString(), zero === -zero, zero + 0n === zero);

const fourHundredDigits = 1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890n;
const repeatedDigits = "1234567890".repeat(40);
console.log("400 digits:", fourHundredDigits.toString().length, fourHundredDigits.toString() === repeatedDigits, fourHundredDigits === BigInt(repeatedDigits));
console.log("400 digits, arithmetic:", (fourHundredDigits % 1_000_000_007n).toString(), (fourHundredDigits >> 1300n).toString(), (fourHundredDigits - fourHundredDigits).toString());

console.log("hexadecimal:", 0x10n === 16n, 0xffn.toString(), 0XABCDEFn.toString(), 0xabcdefn.toString(16), 0xffffffffffffffffn.toString(), 0x10000000000000000n.toString());
const hundredHexadecimalDigits = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn;
console.log("100 hexadecimal digits:", hundredHexadecimalDigits === (1n << 400n) - 1n, hundredHexadecimalDigits.toString(16).length, hundredHexadecimalDigits.toString().length);

console.log("octal:", 0o17n.toString(), 0O777n.toString(), 0o1000000000000000000000n === 1n << 63n, 0o7n + 0o1n === 0o10n);
console.log("binary:", 0b101n.toString(), 0B11110000n.toString(), 0b11111111111111111111111111111111n === 0xffffffffn);
const hundredThirtyBinaryDigits = 0b1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000n;
console.log("130 binary digits:", hundredThirtyBinaryDigits === 1n << 129n, hundredThirtyBinaryDigits.toString());

console.log("separators:", 1_000_000n.toString(), 1_2_3n.toString(), 0xff_ffn.toString(), 0o7_7n.toString(), 0b1010_1010n.toString(), 18_446_744_073_709_551_616n === 0x1_0000_0000_0000_0000n);
console.log("one value in four notations:", [255n, 0xffn, 0o377n, 0b11111111n].every(value => value === 255n));
console.log("negated:", (-5n).toString(), (-0x10n).toString(), (-18446744073709551616n).toString(), BigInt.asUintN(64, -1n) === 0xffff_ffff_ffff_ffffn);

function sumOfLiterals(iterations: number): bigint {
  let sum = 0n;
  for (let i = 0; i < iterations; i++) sum += 0x1_0000_0000_0000_0000n;
  return sum;
}
console.log("in a loop:", sumOfLiterals(1000).toString(), sumOfLiterals(3).toString(16));

function incrementedLiteral(): bigint {
  let value = 9007199254740993n;
  value++;
  return value;
}
console.log("an update leaves the literal unchanged:", incrementedLiteral().toString(), incrementedLiteral().toString(), 9007199254740993n.toString());

function parse(text: string): string {
  try {
    return BigInt(text).toString();
  } catch (error) {
    return error instanceof SyntaxError ? "SyntaxError" : "another error";
  }
}
for (const text of ["12", "12n", "0n", "1_000", "0x10", "0x10n", "0o17", "0b101", "-12", "-0x10", "", " 12 ", "12.0", "1e3"]) console.log("BigInt(" + JSON.stringify(text) + "):", parse(text));
