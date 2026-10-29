// Optional members of each kind are compared with each other and with a value that was kept, strictly and loosely. Most calls give what the types say, some leave members out, and some give values of other kinds.
interface Options {
  flag?: boolean;
  name?: string | null;
  size?: number;
  owner?: { id: number };
  run?: () => number;
  list?: number[];
}

const owner = { id: 1 };
const run = () => 1;
const list = [1];
const one = { valueOf: () => 1 };
const text = { toString: () => "a" };

const values: any[] = [
  undefined,
  null,
  true,
  false,
  0,
  -0,
  1,
  1.5,
  NaN,
  "",
  "a",
  "1",
  "true",
  ["a", "b"].join("").slice(0, 1),
  1n,
  0n,
  Symbol.for("a"),
  owner,
  { id: 1 },
  run,
  list,
  [1],
  one,
  text,
];

function strictly(a: Options, b: Options): number {
  let bits = 0;
  if (a.flag === b.flag) bits |= 1;
  if (a.name === b.name) bits |= 2;
  if (a.size === b.size) bits |= 4;
  if (a.owner === b.owner) bits |= 8;
  if (a.run === b.run) bits |= 16;
  if (a.list === b.list) bits |= 32;
  if (a.flag !== b.flag) bits |= 64;
  if (a.name !== b.name) bits |= 128;
  if (a.size !== b.size) bits |= 256;
  return bits;
}

function loosely(a: Options, b: Options): number {
  let bits = 0;
  if (a.flag == b.flag) bits |= 1;
  if (a.name == b.name) bits |= 2;
  if (a.size == b.size) bits |= 4;
  if (a.owner == b.owner) bits |= 8;
  if (a.run == b.run) bits |= 16;
  if (a.list == b.list) bits |= 32;
  if (a.flag != b.flag) bits |= 64;
  if (a.name != b.name) bits |= 128;
  if (a.size != b.size) bits |= 256;
  return bits;
}

function withWhatWasKept(kept: any[], { flag, name, size, owner, run, list }: Options): number {
  let bits = 0;
  if (kept[0] !== flag) bits |= 1;
  if (kept[1] !== name) bits |= 2;
  if (kept[2] !== size) bits |= 4;
  if (kept[3] !== owner) bits |= 8;
  if (kept[4] !== run) bits |= 16;
  if (kept[5] !== list) bits |= 32;
  if (kept[0] != flag) bits |= 64;
  if (kept[1] != name) bits |= 128;
  if (kept[2] != size) bits |= 256;
  if (kept[3] != owner) bits |= 512;
  return bits;
}

const asDeclared: Options[] = [
  { flag: true, name: "a", size: 1, owner, run, list },
  { flag: false, name: "b", size: 1.5, owner, run, list },
  { name: null },
  { flag: true },
  {},
];

let sum = 0;
for (let round = 0; round < 2000; round++) {
  const a = asDeclared[round % 5];
  const b = asDeclared[(round >> 2) % 5];
  sum =
    (sum * 31 +
      strictly(a, b) +
      loosely(a, b) * 3 +
      withWhatWasKept([b.flag, b.name, b.size, b.owner, b.run, b.list], a) * 7) %
    1000003;
}
console.log(sum);

const all = (value: any): any => ({ flag: value, name: value, size: value, owner: value, run: value, list: value });
for (const left of values) {
  const row: string[] = [];
  for (const right of values) {
    const a = all(left);
    const b = all(right);
    row.push(
      [strictly(a, b), loosely(a, b), withWhatWasKept([right, right, right, right, right, right], a)]
        .map(bits => bits.toString(36))
        .join("."),
    );
  }
  console.log(row.join(" "));
}
for (const value of values)
  console.log(
    strictly(all(value), {}),
    loosely(all(value), {}),
    strictly({}, all(value)),
    loosely({}, all(value)),
    withWhatWasKept([], all(value)),
    withWhatWasKept([value, value, value, value, value, value], {}),
  );
