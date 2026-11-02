// RUN: lower
// OPTIONS: builtin-modules

// Constant arithmetic at the limits of int32.
function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

attempt("2147483647 + 1", () => 2147483647 + 1);
attempt("-2147483648 - 1", () => -2147483648 - 1);
attempt("2147483647 + 2147483647", () => 2147483647 + 2147483647);
attempt("65536 * 65536", () => 65536 * 65536);
attempt("65536 * 32768", () => 65536 * 32768);
attempt("46341 * 46341", () => 46341 * 46341);
attempt("2147483647 * 2147483647", () => 2147483647 * 2147483647);
attempt("(2147483647 * 2147483647) | 0", () => (2147483647 * 2147483647) | 0);
attempt("(65536 * 65536) | 0", () => (65536 * 65536) | 0);
attempt("(2147483647 + 1) | 0", () => (2147483647 + 1) | 0);
attempt("-(-2147483648)", () => -(-2147483648));
attempt("-(-2147483648) | 0", () => -(-2147483648) | 0);
attempt("-2147483648 / -1", () => -2147483648 / -1);
attempt("-2147483648 % -1", () => -2147483648 % -1);
attempt("1 << 31", () => 1 << 31);
attempt("1 << 32", () => 1 << 32);
attempt("(1 << 31) - 1", () => (1 << 31) - 1);
attempt("(1 << 30) * 2", () => (1 << 30) * 2);
attempt("(1 << 30) + (1 << 30)", () => (1 << 30) + (1 << 30));
attempt("-1 >>> 0", () => -1 >>> 0);
attempt("(-1 >>> 0) + 1", () => (-1 >>> 0) + 1);
attempt("-1 >>> 32", () => -1 >>> 32);
attempt("-1 >>> 31", () => -1 >>> 31);
attempt("~2147483647", () => ~2147483647);
attempt("~-2147483648", () => ~-2147483648);
attempt("~4294967295", () => ~4294967295);
attempt("4294967296 | 0", () => 4294967296 | 0);
attempt("4294967297 | 0", () => 4294967297 | 0);
attempt("2147483648 | 0", () => 2147483648 | 0);
attempt("1e21 | 0", () => 1e21 | 0);
attempt("0xffffffff & 0xffffffff", () => 0xffffffff & 0xffffffff);
attempt("0x80000000 ^ 0", () => 0x80000000 ^ 0);
attempt("0 * -1", () => 0 * -1);
attempt("-1 * 0", () => -1 * 0);
attempt("0 / -5", () => 0 / -5);
attempt("-5 % 5", () => -5 % 5);
attempt("5 % -5", () => 5 % -5);
attempt("-0", () => -0);
attempt("-0 + 0", () => -0 + 0);
attempt("-0 - 0", () => -0 - 0);
attempt("0 - 0", () => 0 - 0);
attempt("-0 * 1", () => -0 * 1);
attempt("-(0)", () => -(0));
attempt("-(1 - 1)", () => -(1 - 1));
attempt("+-0", () => +-0);
attempt("-0 | 0", () => -0 | 0);
attempt("1 / -0", () => 1 / -0);
attempt("1 / (0 * -1)", () => 1 / (0 * -1));
attempt("5 / 0", () => 5 / 0);
attempt("-5 / 0", () => -5 / 0);
attempt("0 / 0", () => 0 / 0);
attempt("5 % 0", () => 5 % 0);
attempt("7 / 2", () => 7 / 2);
attempt("(7 / 2) | 0", () => (7 / 2) | 0);
attempt("(-7 / 2) | 0", () => (-7 / 2) | 0);
attempt("-7 % 2", () => -7 % 2);
attempt("2 ** 31", () => 2 ** 31);
attempt("2 ** 31 | 0", () => 2 ** 31 | 0);
attempt("2 ** 32 >>> 0", () => 2 ** 32 >>> 0);
attempt("2 ** 53 + 1", () => 2 ** 53 + 1);
attempt("(-2) ** 31", () => (-2) ** 31);
attempt("0.1 + 0.2", () => 0.1 + 0.2);
attempt("0.1 * 3", () => 0.1 * 3);
attempt("9007199254740992 + 1", () => 9007199254740992 + 1);
attempt("9007199254740992 + 2", () => 9007199254740992 + 2);
attempt("1 + '1'", () => 1 + "1");
attempt("'1' - 1", () => "1" - 1);
attempt("'3' * '4'", () => "3" * "4");
attempt("1 + null", () => 1 + null);
attempt("1 + undefined", () => 1 + undefined);
attempt("1 + true", () => 1 + true);
attempt("[] + 1", () => [] + 1);
attempt("[] * 2", () => [] * 2);
attempt("null | 0", () => null | 0);
attempt("undefined | 0", () => undefined | 0);
attempt("'12' | 0", () => "12" | 0);
attempt("'abc' | 0", () => "abc" | 0);
attempt("true << 4", () => true << 4);
attempt("+''", () => +"");
attempt("+' '", () => +" ");
attempt("+'0x10'", () => +"0x10");
attempt("+'1e3'", () => +"1e3");
attempt("+'-0'", () => +"-0");
attempt("+'1_000'", () => +"1_000");
attempt("+[]", () => +[]);
attempt("+{}", () => +{});
attempt("+null", () => +null);
attempt("+undefined", () => +undefined);
attempt("-'5'", () => -"5");
attempt("-''", () => -"");
attempt("-null", () => -null);
attempt("-false", () => -false);
attempt("~'5'", () => ~"5");
attempt("~~'5.9'", () => ~~"5.9");
attempt("1n + 1n", () => 1n + 1n);
attempt("2n ** 64n", () => 2n ** 64n);
attempt("-(2n ** 63n)", () => -(2n ** 63n));
attempt("7n / 2n", () => 7n / 2n);
attempt("-7n % 2n", () => -7n % 2n);
attempt("1 < 2 < 3", () => 1 < 2 < 3);
attempt("3 > 2 > 1", () => 3 > 2 > 1);
attempt("null >= 0", () => null >= 0);
attempt("null > 0", () => null > 0);
attempt("null == 0", () => null == 0);
attempt("undefined == 0", () => undefined == 0);
attempt("undefined >= 0", () => undefined >= 0);
attempt("'' == 0", () => "" == 0);
attempt("'0' == false", () => "0" == false);
attempt("NaN == NaN", () => NaN == NaN);
attempt("0 === -0", () => 0 === -0);
attempt("1 == 1n", () => 1 == 1n);
attempt("1 === 1n", () => 1 === 1n);
attempt("Math.abs(-2147483648)", () => Math.abs(-2147483648));
attempt("Math.round(-0.4)", () => Math.round(-0.4));
attempt("Math.max(-0, 0)", () => Math.max(-0, 0));
attempt("Math.min(0, -0)", () => Math.min(0, -0));
attempt("Math.imul(65536, 65536)", () => Math.imul(65536, 65536));
attempt("Math.imul(2147483647, 2147483647)", () => Math.imul(2147483647, 2147483647));
attempt("Math.floor(-0.5)", () => Math.floor(-0.5));
attempt("Math.ceil(-0.5)", () => Math.ceil(-0.5));
attempt("Math.pow(2, 31)", () => Math.pow(2, 31));
attempt("Math.sign(-0)", () => Math.sign(-0));
attempt("Math.trunc(-0.9)", () => Math.trunc(-0.9));

// GENERATED: outcome attempt
// CHECK-LABEL: function {{*}}name="outcome"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v2 = Call v0 calleeName="run"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|number|string|symbol|bigint|object flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v1, -, v3 calleeName="show"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v6 = CatchValue
// CHECK-NEXT: v7 = String string="threw "
// CHECK-NEXT: v8 = PropGet v6 key="constructor"
// CHECK-NEXT: v9 = PropGet v8 key="name"
// CHECK-NEXT: v10 = Add v7, v9
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="->"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v9 = Call v8, -, v1 calleeName="outcome"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v6, v4, v0, v7, v10 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
