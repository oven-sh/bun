// `[...list]` copies the elements of a list of integers in one piece also where the new array has storage for any value. The copy is an array of its own.
const hidden = (value: unknown): any => JSON.parse(JSON.stringify(value));
function copy(list: number[]): number[] { return [...list]; }
function withText(list: number[]): unknown[] { return ["first", ...list, "last"]; }
function twice(list: number[]): number[] { return [...list, ...list]; }
function mixed(a: number[], b: number[], c: string[]): unknown[] { return [...a, ...b, ...c, ...a]; }
function describe(list: unknown[]): string {
  const parts: string[] = [];
  for (let i = 0; i < list.length; i++) parts.push(i in list ? typeof list[i] + ":" + String(list[i]) : "hole");
  return list.length + " [" + parts.join(", ") + "]";
}
const literal = [1, 2, 3];
const sparse = [1, 2, 3, 4];
delete (sparse as any)[2];
const long: number[] = [];
for (let i = 0; i < 3000; i++) long.push(i & 15);
for (let round = 0; round < 3; round++) {
  const given: number[] = hidden([round, 5, 6]);
  console.log(describe(copy(literal)), describe(copy(given)), describe(copy([])), describe(copy(sparse)));
  console.log(describe(withText(literal)), describe(withText(given)), describe(withText(sparse)));
  console.log(describe(twice(given)), describe(mixed(given, [0.5, -0, NaN], ["a"])), describe(mixed(literal, hidden([]), [])));
  const own = copy(given);
  own[0] = 100 + round;
  (own as unknown[]).push("text");
  console.log(describe(own), describe(given), copy(long).length, copy(long)[2999], withText(long).length, twice(long)[5999]);
  let grown = copy(literal);
  for (let i = 0; i < 4; i++) grown = [...grown, ...grown];
  console.log(grown.length, grown[47], describe(copy(Object.freeze([7, 8]) as number[])));
}
