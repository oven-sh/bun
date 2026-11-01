// Each function returns a list literal of numbers and is handed an empty list that it does not use. Its caller pushes nothing to another empty list, prints, and returns the list, whose elements are read by index.
function show(v: any): string {
  return typeof v === "number" ? String(v) : v instanceof RegExp ? v.source : "x";
}
process.on("unhandledRejection", (e: unknown) => show(e));

function makeOne(unused: []): number[] {
  return [1.5];
}
const one = (): number[] => {
  const empty: [] = [];
  const texts: (string | undefined)[] = empty;
  const first = texts[0];
  const record = { y: empty.push() };
  const made = makeOne([]);
  console.log(show(texts));
  return made;
};
for (let i = 0; i < 1; i++) console.log(show(one()[0]));

function makeTwo(unused: []): number[] {
  return [0.1, 2.25];
}
const two = (): number[] => {
  const empty: [] = [];
  const texts: (string | undefined)[] = empty;
  const first = texts[0];
  const record = { y: empty.push() };
  const made = makeTwo([]);
  console.log(show(texts));
  return made;
};
for (let i = 0; i < 1; i++) {
  const list = two();
  console.log(show(list[0]), show(list[1]), list.length);
}

function makeWholeAndFraction(unused: []): number[] {
  return [1, 2.5];
}
const wholeAndFraction = (): number[] => {
  const empty: [] = [];
  const texts: (string | undefined)[] = empty;
  const first = texts[0];
  const record = { y: empty.push() };
  const made = makeWholeAndFraction([]);
  console.log(show(texts));
  return made;
};
for (let i = 0; i < 1; i++) {
  const list = wholeAndFraction();
  console.log(show(list[0]), show(list[1]));
}
