// A polyfill is stored over a built-in object only where there is none, beside classes whose static methods have the same name.
class Floats extends Float32Array {}
class Steps extends Iterator {}
console.log(new Floats(2).length, typeof Steps);
if (!globalThis.Temporal) globalThis.Temporal = { PlainTime: { from: text => text } };
globalThis.Temporal.PlainDate ??= { from: text => text };

const read = text => String(Temporal.PlainTime.from(text));
for (const text of ["12:30", "13:45"]) console.log(read(text), String(Temporal.PlainDate.from("2026-11-13")));
