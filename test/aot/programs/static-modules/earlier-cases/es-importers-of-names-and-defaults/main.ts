// ES importers of CommonJS files, with and without the marker, with and without a `default`.
declare const console: { log(...values: unknown[]): void };
import { a, b, f } from "./plain.cjs";
import * as plain from "./plain.cjs";
import plainDefault from "./plain.cjs";
import markedDefault, { named, g } from "./marked.cjs";
import * as marked from "./marked.cjs";
// @ts-ignore
import bareDefault from "./markedbare.cjs";
import * as bare from "./markedbare.cjs";
import { default as renamed } from "./marked.cjs";
import * as nodefault from "./nodefault.cjs";
console.log("named", a, b, f(1), named, g());
console.log("ns", plain.a, plain.b, plain.f(2), marked.named, marked.g(), bare.only);
console.log("default", plainDefault.a, plainDefault.f(3), plainDefault.default, markedDefault, renamed, bareDefault.only);
// @ts-ignore
console.log("ns.default", marked.default, bare.default.only, plain.missing, nodefault.default.a);
function later() { return a + plain.a + plainDefault.a; }
console.log("later", later());
