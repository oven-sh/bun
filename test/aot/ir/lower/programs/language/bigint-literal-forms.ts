// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: sumOfLiterals incrementedLiteral parse
// CHECK-LABEL: function {{*}}name="sumOfLiterals"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=undefined|null|bigint site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = BigInt digits="0"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|bigint site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_4]]}
// CHECK-NEXT: Jump -> next b2(v2, v4)
// CHECK-NEXT: b2(v5: undefined|null|bigint, v6: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = Less v6, v0
// CHECK-NEXT: Branch v8 -> taken b3(| 0, 1), notTaken b6(| 0, 1)
// CHECK-NEXT: b3(v9, v10):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v11 = BigInt digits="18446744073709551616"
// CHECK-NEXT: v12 = Add v5, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|bigint site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v14 = Increment v9
// CHECK-NEXT: v15 = Convert v14 declared={type=number site=[[w_4]]}
// CHECK-NEXT: Jump -> next b2(v13, v15)
// CHECK-NEXT: b6(v16, v17):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v18 = Convert v5 declared={type=undefined|null|bigint site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="incrementedLiteral"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|bigint site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = BigInt digits="9007199254740993"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|bigint site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v2 = Increment v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|bigint site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="parse"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = Builtin builtin=BigInt
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="BigInt"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|bigint site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v4 = PropGet v3 key="toString"
// CHECK-NEXT: v5 = Call v4, v3 calleeKey="toString" calleeName="toString"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Return v6
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v7 = CatchValue
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="SyntaxError" [isFreeName]
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(SyntaxError) flags=[IsExpected]}
// CHECK-NEXT: v11 = InstanceOf v7, v10 writtenExpression="error instanceof SyntaxError"
// CHECK-NEXT: v12 = ToBoolean v11
// CHECK-NEXT: Branch v12 -> taken b4(| 0), notTaken b6(| 0)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v14 = String string="SyntaxError"
// CHECK-NEXT: Jump -> next b8(v14)
// CHECK-NEXT: b6(v15):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v16 = String string="another error"
// CHECK-NEXT: Jump -> next b8(v16)
// CHECK-NEXT: b8(v17):
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
