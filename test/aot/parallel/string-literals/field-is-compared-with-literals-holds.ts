// A field whose type is a union of literal strings lies in a narrow slot: a small word for a literal, a reference for any other string. `===`, `!==`, `==`, `switch`, `typeof` and tests for
// undefined and null look at the word as it was loaded. Every kind of content goes through the same readers: the literals, the same texts made at run time, other texts, undefined and null.
type Kind = "circle" | "square" | "line" | "";
class Shape {
  kind: Kind;
  other: Kind | undefined;
  size: number;
  next: Shape | null = null;
  constructor(kind: Kind, size: number) {
    this.kind = kind;
    this.other = undefined;
    this.size = size;
  }
}
const out: string[] = [];
const suffix = process.argv[2] ?? "";
const hide = new Function("value", "return value" + suffix) as <V>(value: V) => V;
const store = new Function("object", "key", "value", "object[key] = value" + suffix) as (object: object, key: string, value: unknown) => void;

function compare(shape: Shape): string {
  return [
    shape.kind === "circle", shape.kind !== "square", shape.kind == "line", "circle" === shape.kind, shape.kind === "", shape.kind === shape.other, shape.other === "square",
    shape.other === undefined, shape.other == null, shape.kind === (undefined as unknown as Kind), typeof shape.kind, typeof shape.other, !shape.kind, !!shape.other,
  ].join(" ");
}
function choose(shape: Shape): string {
  switch (shape.kind) {
    case "circle":
      return "round " + shape.size;
    case "square":
      return "four " + shape.size;
    case "":
      return "empty " + shape.size;
    case "line":
      return "thin " + shape.size;
  }
  return "none of them: " + String(shape.kind);
}
function chooseWithOthers(shape: Shape, text: string): string {
  switch (shape.other as string | undefined) {
    case "circle":
      return "circle";
    case "a text that no type lists":
      return "listed nowhere";
    case text:
      return "the operand";
    case undefined:
      return "undefined";
  }
  return "default";
}
function area(first: Shape): number {
  let sum = 0;
  for (let shape: Shape | null = first; shape !== null; shape = shape.next) {
    if (shape.kind === "circle") sum += 3 * shape.size * shape.size;
    else if (shape.kind === "square") sum += shape.size * shape.size;
    else if (shape.kind !== "line") sum -= 1;
  }
  return sum;
}
function show(name: string, shape: Shape) {
  out.push(`${name}: ${compare(shape)} | ${choose(shape)} | ${chooseWithOthers(shape, "squ" + "are".slice(0, hide(3)))} | ${area(shape)}`);
}

const made = (text: string) => hide(text.slice(0, hide(1))) + hide(text.slice(1));
for (const kind of ["circle", "square", "line", ""] as const) {
  show(`the literal "${kind}"`, hide(new Shape(kind, 2)));
  show(`"${kind}" made at run time`, hide(new Shape(made(kind) as Kind, 3)));
  const both = hide(new Shape(kind, 4));
  both.other = kind;
  show(`"${kind}" in both fields`, both);
  const bothMade = hide(new Shape(kind, 5));
  bothMade.other = made(kind) as Kind;
  show(`"${kind}" and the same text made at run time`, bothMade);
  const unseen = hide(new Shape("line", 6));
  store(unseen, "kind", made(kind));
  store(unseen, "other", kind);
  show(`"${kind}" stored by code that nobody sees`, unseen);
}
for (const [word, value] of [["another text", "triangle"], ["a text that no type lists", "a text that no type lists"], ["a long text", "circle".repeat(40)], ["undefined", undefined], ["null", null], ["a number", 7], ["an object", { toString: () => "circle" }]] as const) {
  const cast = hide(new Shape(hide<unknown>(value) as Kind, 7));
  show(`${word} behind a cast`, cast);
  const stored = hide(new Shape("circle", 8));
  store(stored, "kind", value);
  store(stored, "other", value);
  show(`${word} stored by code that nobody sees`, stored);
  stored.kind = "square";
  stored.other = "square";
  show(`${word}, and then a literal again`, stored);
}
const chain = hide(new Shape("circle", 1));
chain.next = hide(new Shape(made("square") as Kind, 2));
chain.next.next = hide(new Shape("line", 3));
chain.next.next.next = hide(new Shape(hide<unknown>("oval") as Kind, 4));
show("a chain", chain);
let total = 0;
for (let turn = 0; turn < 2000; turn++) total += area(chain);
out.push("many turns: " + total);
console.log(out.join("\n"));
