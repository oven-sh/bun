// STATISTIC: ConstantArrayElementsFolded >= 4
// The length and the elements of an array of constants in a variable of the file, where nobody changes the array, and where an alias, a method, a length or a late key does.
const lines: string[] = [];
const factors = [1, -2, 3, 0.5];
const weights = [4, 8, 15, 16, 23, 42];
const names = ["a", "bc", "", "def"];
const pushed = [1, 2, 3];
const aliased = [5, 6, 7];
const shortened = [1, 2, 3, 4];
const stored = [9, 8, 7];
const late = [1, 1, 1];
const kept: { list: number[] } = { list: aliased };
function horner(x: number): number {
  let r = 0;
  for (let i = factors.length - 1; i >= 0; i--) r = r * x + factors[i]!;
  return r;
}
function weighed(x: number): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += weights[i]! * (i + x);
  return sum;
}
function joined(x: string): string {
  let text = "";
  for (let i = 0; i < names.length; i++) text += names[i]!.toUpperCase() + x + names[names.length - 1 - i]!;
  return text;
}
function table(): string {
  let text = "";
  for (let y = 0; y < factors.length; y++) for (let x = 0; x < weights.length; x++) text += factors[y]! * weights[x]! + (x + 1 === weights.length ? ";" : ",");
  return text;
}
const sumOf = (list: number[]): number => {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i]!;
  return sum;
};
function changing(): string {
  let sum = 0;
  for (let i = 0; i < pushed.length; i++) sum += pushed[i]!;
  for (let i = aliased.length - 1; i >= 0; i--) sum = sum * 3 + aliased[i]!;
  for (let i = 0; i < shortened.length; i++) sum += shortened[i]! * 7;
  for (let i = 0; i < stored.length; i++) sum += stored[i]! * 11;
  for (let i = 0; i < late.length; i++) sum += late[i]! * 13;
  return sum + " " + [pushed.length, aliased.length, shortened.length, stored.length, late.length].join();
}
function early(): number {
  return after.length;
}
try {
  lines.push(String(early()));
} catch (error) {
  lines.push((error as Error).name);
}
const after = [1, 2];
for (let turn = 0; turn < 5; turn++) {
  for (const x of [0, 1, 0.5, -3, NaN]) lines.push([horner(x), weighed(x), joined(String(x)), table().length, sumOf(weights)].join(" "));
  lines.push(changing(), String(early()));
  if (turn === 1) pushed.push(4);
  if (turn === 2) kept.list.splice(1, 1);
  if (turn === 2) shortened.length = 2;
  if (turn === 3) stored[1] = 100;
  if (turn === 3) late[turn + 2] = 5;
}
console.log(lines.join("\n"));

const zeros = [0, -0, 1, -1];
const mixed = [9007199254740991, -2147483648, 0.1, 1e300];
const given = [1, 2, 3, 4];
const indexes = [-1, 0, 3, 4, 9];
const show = (value: unknown) => (Object.is(value, -0) ? "-0" : String(value));
function at(): string {
  return [zeros[0], zeros[1], zeros[3], mixed[0], mixed[1], mixed[2], mixed[3], zeros[4], zeros[-1], given[0], given[3]].map(show).join();
}
function over(): string {
  let text = "";
  for (let i = 0; i < 4; i++) text += show(zeros[i]! * mixed[i]!) + "/" + show(given[i]) + ";";
  for (const index of indexes) text += show(zeros[index]) + show(given[index]) + " ";
  return text;
}
const change = (array: number[]) => {
  array[0] = 42;
  array.length = 3;
};
console.log(at(), over());
change(given);
console.log(at(), over());
