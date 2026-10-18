// -0 is equal to 0, so it satisfies the constant type 0; the result holds what the text says, as JSON.parse(text) does.
type Zero = { n: 0 };
type Bit = { n: 0 | 1 };
type Sized = { n: 0 | "none"; size?: 0 };
type Any = { n: number };
const sign = (value: unknown) => (Object.is(value, -0) ? "-0" : String(value));
for (const spelled of ["-0", "-0.0", "-0e5", "-0E-5", "-1e-400", "0", "0.0", "0e5", "1e-400"]) {
  console.log(
    spelled,
    sign(JSON.parse<Zero>(`{"n":${spelled}}`).n),
    sign(JSON.parse<Zero>(`{ "n" : ${spelled} }`).n),
    sign(JSON.parse<Zero>(`{"o":1,"n":${spelled}}`).n),
    sign(JSON.parse<Zero>(`{"\\u006e":${spelled}}`).n),
    sign(JSON.parse<Bit>(`{"n":${spelled}}`).n),
    sign(JSON.parse<Sized>(`{"n":${spelled},"size":${spelled}}`).size),
    sign(JSON.parse<Sized>(`{"size":${spelled},"n":${spelled}}`).n),
    sign(JSON.parse<Any>(`{"n":${spelled}}`).n),
    sign(JSON.parse<0>(spelled)),
    sign(JSON.parse<0 | 1>(spelled)),
    sign(JSON.parse<[0 | 1]>(`[${spelled}]`)[0]),
    sign(JSON.parse<[0, 0]>(`[${spelled}, ${spelled}]`)[1]),
    sign(JSON.parse<(0 | 1)[]>(`[1,${spelled}]`)[1]),
    sign(JSON.parse<Record<string, 0>>(`{"k":${spelled}}`).k),
    1 / JSON.parse<Zero>(`{"n":${spelled}}`).n,
    JSON.stringify(JSON.parse<Zero>(`{"n":${spelled}}`)),
  );
}
console.log(sign(JSON.parse<Bit>('{"n":1}').n), sign(JSON.parse<{ n: -1 | 0 }>('{"n":-1}').n), sign(JSON.parse<{ n: 1.5 }>('{"n":1.5}').n));
