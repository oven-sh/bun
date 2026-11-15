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

// CHECK-LABEL: function {{*}}name="sign"
