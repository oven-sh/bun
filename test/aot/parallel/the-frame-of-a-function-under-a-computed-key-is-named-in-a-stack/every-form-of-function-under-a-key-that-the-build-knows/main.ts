// Which forms of a computed key name the frame under plain Bun, and which under a compiled program?
import { step } from "./key";

const here = "written/here";
const field = "written/here/field";
let keep = Date.now() > 0 ? 1 : 0;
const own = Symbol("own");
const stack = () => new Error("made up").stack ?? "";
const second = (text: string) => (text.split("\n")[2] ?? "").replace(/\(.*[/\\]/, "(").replace(/:\d+:\d+\)/, ")").trim();

const holder = {
  [step]() { const s = stack(); return keep > 0 ? s : ""; },
  [here]() { const s = stack(); return keep > 0 ? s : ""; },
  ["joined/" + "up"]() { const s = stack(); return keep > 0 ? s : ""; },
  [`templated/${here}`]() { const s = stack(); return keep > 0 ? s : ""; },
  [Symbol.iterator]() { const s = stack(); return keep > 0 ? s : ""; },
  [own]() { const s = stack(); return keep > 0 ? s : ""; },
  [7]() { const s = stack(); return keep > 0 ? s : ""; },
  get [here + "/get"]() { const s = stack(); return keep > 0 ? s : ""; },
  [here + "/arrow"]: () => { const s = stack(); return keep > 0 ? s : ""; },
  [here + "/function"]: function () { const s = stack(); return keep > 0 ? s : ""; },
  *[here + "/generator"]() { const s = stack(); yield keep > 0 ? s : ""; },
  async [here + "/async"]() { const s = stack(); return keep > 0 ? s : ""; },
} as Record<PropertyKey, any>;
class Holder {
  [here]() { const s = stack(); return keep > 0 ? s : ""; }
  static [here + "/static"]() { const s = stack(); return keep > 0 ? s : ""; }
  [field] = () => { const s = stack(); return keep > 0 ? s : ""; };
}
const instance = new Holder() as Record<PropertyKey, any>;

const rows: [string, string][] = [
  ["imported const", holder[step]()],
  ["const of the file", holder[here]()],
  ["two literals joined", holder["joined/up"]()],
  ["template", holder["templated/written/here"]()],
  ["Symbol.iterator", holder[Symbol.iterator]()],
  ["a symbol of the file", holder[own]()],
  ["a number", holder[7]()],
  ["getter", holder["written/here/get"]],
  ["arrow as a value", holder["written/here/arrow"]()],
  ["function as a value", holder["written/here/function"]()],
  ["generator", holder["written/here/generator"]().next().value],
  ["async", await holder["written/here/async"]()],
  ["class method", instance[here]()],
  ["static method", (Holder as any)["written/here/static"]()],
  ["class field arrow", instance["written/here/field"]()],
];
for (const [name, text] of rows) console.log(name.padEnd(24), second(text));
