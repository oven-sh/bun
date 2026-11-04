// RUN: lower
// OPTIONS: builtin-modules

// -0 under the constant type 0: the result holds what the text says, as JSON.parse(text) does.
type Zero = { n: 0 };
type Bit = { n: 0 | 1 };
type Sized = { n: 0 | "none"; size?: 0 };
type Any = { n: number };
const sign = (value: unknown) => (Object.is(value, -0) ? "-0" : String(value));
for (const spelled of ["-0", "-0.0", "-0e5", "-0E-5", "-1e-400", "0", "0.0", "0e5", "1e-400"]) {
  console.log(
    spelled,
    sign((JSON.parse(`{"n":${spelled}}`) as Zero).n),
    sign((JSON.parse(`{ "n" : ${spelled} }`) as Zero).n),
    sign((JSON.parse(`{"o":1,"n":${spelled}}`) as Zero).n),
    sign((JSON.parse(`{"\\u006e":${spelled}}`) as Zero).n),
    sign((JSON.parse(`{"n":${spelled}}`) as Bit).n),
    sign((JSON.parse(`{"n":${spelled},"size":${spelled}}`) as Sized).size),
    sign((JSON.parse(`{"size":${spelled},"n":${spelled}}`) as Sized).n),
    sign((JSON.parse(`{"n":${spelled}}`) as Any).n),
    sign(JSON.parse(spelled) as 0),
    sign(JSON.parse(spelled) as 0 | 1),
    sign((JSON.parse(`[${spelled}]`) as [0 | 1])[0]),
    sign((JSON.parse(`[${spelled}, ${spelled}]`) as [0, 0])[1]),
    sign((JSON.parse(`[1,${spelled}]`) as (0 | 1)[])[1]),
    sign((JSON.parse(`{"k":${spelled}}`) as Record<string, 0>).k),
    1 / (JSON.parse(`{"n":${spelled}}`) as Zero).n,
    JSON.stringify(JSON.parse(`{"n":${spelled}}`) as Zero),
  );
}
console.log(sign((JSON.parse('{"n":1}') as Bit).n), sign((JSON.parse('{"n":-1}') as { n: -1 | 0 }).n), sign((JSON.parse('{"n":1.5}') as { n: 1.5 }).n));

// GENERATED: sign
// CHECK-LABEL: function {{*}}name="sign"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectIs
// CHECK-NEXT: v3 = Double number=-0
// CHECK-NEXT: v4 = Call v2, v1, v0, v3 calleeName="Object.is"
// CHECK-NEXT: v5 = Convert v4 declared={type=boolean} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = ToBoolean v5
// CHECK-NEXT: Branch v6 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v7):
// CHECK-NEXT: v8 = String string="-0"
// CHECK-NEXT: Return v8
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: v10 = Builtin builtin=String
// CHECK-NEXT: v11 = Call v10, -, v0 calleeName="String"
// CHECK-NEXT: ReturnCall v11 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
