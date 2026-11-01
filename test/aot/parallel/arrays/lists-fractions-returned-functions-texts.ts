// Each function returns a list literal of numbers and is handed a list of other values that it does not use. Its caller pushes nothing to an empty list, prints, and returns the list, whose elements are read by index.
function show(v: any): string {
  return typeof v === "number" ? String(v) : typeof v === "string" ? v : v instanceof RegExp ? v.source : "x";
}
process.on("unhandledRejection", (e: unknown) => show(e));

function makeOne(unused: any[]): number[] {
  return [1.5];
}
const one = (): number[] => {
  const empty: [] = [];
  const texts: (string | undefined)[] = empty;
  const first = texts[0];
  const record = { y: empty.push() };
  const made = makeOne(["text"]);
  console.log(show(texts));
  return made;
};
for (let i = 0; i < 3; i++) console.log(show(one()[0]));

function makeWithAHole(unused: any[]): number[] {
  return [1.5, , 2.5] as number[];
}
const withAHole = (): number[] => {
  const empty: [] = [];
  const texts: (string | undefined)[] = empty;
  const first = texts[0];
  const record = { y: empty.push() };
  const made = makeWithAHole(["text", , 1]);
  console.log(show(texts));
  return made;
};
for (let i = 0; i < 3; i++) {
  const list = withAHole();
  console.log(show(list[0]), show(list[1]), show(list[2]), 1 in list, list.length);
}

function makeWholeNumbers(unused: any[], x: number): number[] {
  return [x | 0, (x * 2) | 0];
}
const wholeNumbers = (x: number): number[] => {
  const empty: [] = [];
  const texts: (string | undefined)[] = empty;
  const first = texts[0];
  const record = { y: empty.push() };
  const made = makeWholeNumbers(["text", 1.5], x);
  console.log(show(texts));
  return made;
};
for (let i = 0; i < 3; i++) console.log(show(wholeNumbers(i + 3)[1]));
