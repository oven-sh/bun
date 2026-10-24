// JSON.parse<T>(text) takes the arm that JSON.parse's own value of the tag selects, also where the text repeats the tag or has it after a value too deep to skip.
import type { Schema } from "bun";
type A = { kind: "a"; x: number };
type B = { kind: "b"; x: string; n: number & Schema.Default<1> };
type Named = { v: { kind: "a" } | { kind: "b" }; d: number & Schema.Default<1> } | { v: unknown };
type Chain = { next: Chain | null };
type Deep = { kind: "a"; t: Chain; n: number & Schema.Default<1> } | { kind: "b" } | { t: Chain };

console.log("the arm of the first tag refuses", JSON.stringify(JSON.parse<{ v: A | B } | { v: unknown }>('{"v":{"kind":"a","x":"s","kind":"b"}}')));
console.log("the first tag names no arm", JSON.stringify(JSON.parse<Named>('{"v":{"kind":1,"kind":"a"}}')));
const deep: any = JSON.parse<Deep>('{"t":' + '{"next":'.repeat(70) + "null" + "}".repeat(70) + ',"kind":"a"}');
console.log("the tag after seventy levels", Object.keys(deep).join(), deep.n);
