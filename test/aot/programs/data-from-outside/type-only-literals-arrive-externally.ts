// String literal types that no expression of the program spells: values that hold them come from parsed data and from untyped code, and are told apart as the types say.
const shift = Date.now() < 1 ? 1 : 0;
function spell(codes: number[]): string {
  return codes.map(code => String.fromCharCode(code + shift)).join("");
}
function codesOf(reversed: string): number[] {
  const codes: number[] = [];
  for (let i = reversed.length - 1; i >= 0; i--) codes.push(reversed.charCodeAt(i));
  return codes;
}
const square = spell(codesOf("erauqs-delaes"));
const triangle = spell(codesOf("elgnairt-delaes"));
const quiet = spell(codesOf("edom-teiuq"));
const accented = spell(codesOf("éfac-delaes"));
const wide = spell(codesOf("→-delaes"));

type Shape = { kind: "circle"; size: number } | { kind: "sealed-square"; size: number; side: number } | { kind: "sealed-triangle"; size: number; side: number; height: number };
type Mode = "loud" | "quiet-mode" | "sealed-café" | "sealed-→";
interface Options {
  mode: Mode;
  limit: number;
}
interface Tagged {
  tag: "sealed-tag";
  count: number;
}
type Letter = { to: "loud"; body: string } | { to: "quiet-mode"; body: string; copies?: number };

function describe(shape: Shape): string {
  if (shape.kind === "circle") return "circle " + shape.size;
  return shape.kind + " " + shape.size + " " + shape.side + " " + ("height" in shape ? shape.height : "flat");
}
function show(options: Options): string {
  return options.mode + ":" + options.mode.length + ":" + options.limit + ":" + (options.mode === "loud");
}
function parsed<T>(text: string): T {
  return JSON.parse(text) as T;
}

const circle: Shape = { kind: "circle", size: 1 };
console.log(describe(circle));
console.log(describe(JSON.parse('{"kind":"circle","size":2}') as Shape));
console.log(describe(JSON.parse('{"kind":"' + square + '","size":3,"side":4}') as Shape));
console.log(describe(JSON.parse('{"kind":"' + triangle + '","size":5,"side":6,"height":7}') as Shape));
console.log(describe(JSON.parse('{"size":8,"side":9,"kind":"' + square + '"}') as Shape));
console.log(describe(parsed<Shape>('{"kind":"' + triangle + '","size":10,"side":11,"height":12}')));

const shapes = JSON.parse('[{"kind":"' + square + '","size":1,"side":2},{"kind":"circle","size":3},{"kind":"' + triangle + '","size":4,"side":5,"height":6}]') as Shape[];
for (const shape of shapes) console.log(describe(shape), Object.keys(shape).join());

const own: Options = { mode: "loud", limit: 1 };
console.log(show(own));
for (const mode of [quiet, accented, wide, "loud"]) {
  console.log(show(JSON.parse(JSON.stringify({ mode, limit: mode.length })) as Options));
  (own as any).mode = mode;
  console.log(show(own), JSON.stringify(own));
}

const rope = quiet.slice(0, 3) + quiet.slice(3);
const inSixteenBits = (wide + quiet).slice(wide.length);
const part = ("<" + quiet + ">").slice(1, -1);
for (const mode of [rope, inSixteenBits, part]) {
  const options = JSON.parse("{}") as Options;
  (options as any).mode = mode;
  (options as any).limit = 2;
  console.log(show(options), mode === quiet);
}

function count(tagged: Tagged): string {
  return tagged.tag + " " + tagged.count;
}
const tag = spell(codesOf("gat-delaes"));
const tagged = JSON.parse('{"tag":"' + tag + '","count":1}') as Tagged;
console.log(count(tagged));
(tagged as any).tag = tag.slice(0, 4) + tag.slice(4);
console.log(count(tagged));
(tagged as any).count = 2;
console.log(count(tagged), JSON.stringify(tagged));

function read(letter: Letter): string {
  if (letter.to === "loud") return "LOUD " + letter.body;
  return letter.to + " " + letter.body + " " + (letter.copies ?? "none");
}
function post(to: string, body: string, copies?: number): Letter {
  const letter: any = { to, body };
  if (copies !== undefined) letter.copies = copies;
  return letter;
}
console.log(read({ to: "loud", body: "a" }));
console.log(read(post("loud", "b")));
console.log(read(post(quiet, "c")));
console.log(read(post(quiet, "d", 2)));
console.log(read(post(rope, "e", 3)));

const sameLength = spell(codesOf("edom-tsiuq"));
const unlisted = JSON.parse('{"mode":"' + sameLength + '","limit":3}') as Options;
console.log(unlisted.mode, unlisted.limit, unlisted.mode.length === quiet.length);
