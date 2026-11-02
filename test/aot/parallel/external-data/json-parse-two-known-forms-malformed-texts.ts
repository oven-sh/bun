interface Flat { a: number; b?: number; c?: string }
interface Tree { name: string; size: number; children: Tree[]; more?: number }
interface Inner { p: number; q?: number }
interface Outer { id: number; inner: Inner | null; list: Inner[]; tail?: number }
const untyped = (text: string): unknown => { const parse: (text: string) => any = JSON.parse; return parse(text); };
function walk(value: unknown): string {
  if (Array.isArray(value)) return "[" + Object.getOwnPropertyNames(value).length + "|" + value.map(walk).join() + "]";
  if (value && typeof value === "object") return "{" + Reflect.ownKeys(value).map(key => String(key) + ":" + walk((value as Record<string, unknown>)[key as string])).join() + "}";
  return Object.is(value, -0) ? "-0" : typeof value + " " + String(value);
}
const answer = (parse: (text: string) => unknown, text: string) => { try { return walk(parse(text)); } catch (error) { return (error as Error).name + ": " + (error as Error).message; } };

const leaf = (more: string) => `{"name":"l","k":1,"size":2,"children":[],"o":1${more}}`;
const families: { label: string; parse: (text: string) => unknown; forms: string[] }[] = [
  { label: "flat", parse: text => JSON.parse(text) as Flat, forms: [`{"x":1,"a":1}`, `{"x":1,"a":1,"b":2}`, `{"x":1,"a":1,"y":2}`, `{"x":1,"a":1,"b":2,"y":3}`] },
  { label: "tree", parse: text => JSON.parse(text) as Tree, forms: [
    `{"name":"n","k":1,"size":1,"children":[${leaf("")}],"o":1}`,
    `{"name":"n","k":1,"size":1,"children":[${leaf("")},${leaf(`,"p":2`)}],"o":1,"p":2}`,
    `{"name":"n","k":1,"size":1,"children":[${leaf(`,"more":3`)}],"o":1,"more":2}`,
  ] },
  { label: "records", parse: text => JSON.parse(text) as Outer, forms: [
    `{"e":0,"id":1,"inner":{"p":1},"f":1,"list":[]}`,
    `{"e":0,"id":1,"inner":{"p":1,"q":2},"f":1,"list":[]}`,
    `{"e":0,"id":1,"inner":{"p":1,"r":2},"f":1,"list":[{"p":1,"r":2},{"p":1,"r":2,"q":3}]}`,
    `{"e":0,"id":1,"inner":null,"f":1,"list":[{"p":1,"r":2}],"tail":4,"g":5}`,
  ] },
];
const more = [",", "}", "]", ",}", ",]"];
const step = 1;
let wrong = 0, texts = 0, hash = 0, sinceCollection = 0;
for (const { label, parse, forms } of families) {
  for (const first of forms) for (const second of forms) {
    if (first === second) continue;
    const ask = (text: string) => {
      if (++sinceCollection === 16) { sinceCollection = 0; Bun.gc(true); }
      for (let i = 0; i < 3; i++) { parse(first); parse(second); }
      const typed = answer(parse, text), plain = answer(untyped, text);
      texts++;
      for (let i = 0; i < typed.length; i++) hash = (hash * 31 + typed.charCodeAt(i)) | 0;
      if (typed !== plain && wrong++ < 5) console.log("DIFFERS", label, JSON.stringify(first), JSON.stringify(second), JSON.stringify(text), "\n typed  ", typed, "\n untyped", plain);
    };
    for (let at = 0; at <= second.length; at += step) {
      ask(second.slice(0, at));
      ask(second.slice(0, at) + second.slice(at + 1));
      for (const text of more) {
        ask(second.slice(0, at) + text + second.slice(at));
      }
    }
  }
  console.log(label, "wrong", wrong, "texts", texts, hash);
}
