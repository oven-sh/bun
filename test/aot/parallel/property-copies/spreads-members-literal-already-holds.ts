// A literal holds members before it spreads a record of another type, over and over. The record has some of its optional members, in one order or another; now and then it has a member that the literal already holds, or one whose value is undefined, and between the rounds members go and come back, copies become prototypes and the heap is collected.
interface Options {
  size?: number;
  name?: string;
  depth?: number;
  note?: string;
  wide?: number;
  label?: number;
  first?: string;
}
interface Labeled extends Options {
  label: number;
}
interface Named extends Options {
  first: string;
  label: number;
}

function makeOptions(bits: number): Options {
  const made: Options = {};
  if (bits & 1) made.size = bits;
  if (bits & 2) made.name = "name" + bits;
  if (bits & 4) made.depth = bits * 0.5;
  if (bits & 8) made.note = undefined;
  if (bits & 16) made.wide = 2 ** 40 + bits;
  if (bits & 32) made.label = -bits;
  if (bits & 64) made.first = "from the record";
  return made;
}
function makeOptionsBackwards(bits: number): Options {
  const made: Options = {};
  if (bits & 64) made.first = "from the record";
  if (bits & 32) made.label = -bits;
  if (bits & 16) made.wide = -(2 ** 31) - bits;
  if (bits & 8) made.note = "note";
  if (bits & 4) made.depth = bits;
  if (bits & 2) made.name = "";
  if (bits & 1) made.size = -0;
  return made;
}

const kept: object[] = [];
function label(options: Options, i: number): Labeled {
  return { label: i, ...options };
}
function nameAndLabel(options: Options, i: number): Named {
  return { first: "written", label: i, ...options };
}
function labelAndSize(options: Options, i: number): Labeled {
  return { label: i, size: 7, ...options };
}
function labelAndSizeBehind(options: Options, i: number): Labeled {
  return { label: i, ...options, size: i + 1 };
}
function labelTwoRecords(options: Options, more: Options, i: number): Labeled {
  return { label: i, ...options, ...more };
}

function describe(made: object): string {
  return (
    Object.keys(made).join() +
    " " +
    JSON.stringify(made, (key, value) => (value === undefined ? "undefined" : Object.is(value, -0) ? "-0" : value))
  );
}

const lines: string[] = [];
function round(records: Options[], title: string) {
  for (let i = 0; i < records.length * 4; i++) {
    const options = records[i % records.length];
    const made = [
      label(options, i),
      nameAndLabel(options, i),
      labelAndSize(options, i),
      labelAndSizeBehind(options, i),
      labelTwoRecords(options, records[(i + 5) % records.length], i),
    ];
    kept[i & 15] = made[i % made.length];
    if (i >= records.length * 3) lines.push(title + " " + i + " " + made.map(describe).join(" | "));
  }
}

const records: Options[] = [];
for (let bits = 0; bits < 128; bits += 3) records.push(makeOptions(bits), makeOptionsBackwards(bits));
round(records, "as made");
for (const options of records) delete options.name;
round(records, "without a name");
for (const [i, options] of records.entries()) if (i & 1) options.name = "back";
round(records, "with a name again");
Bun.gc(true);
round(records, "behind a collection");
const heir = Object.create(label(records[5], 1));
round(records, "beside a prototype");
for (const [i, options] of records.entries()) if (i % 3 === 0) Object.freeze(options);
round(records, "some are frozen");
console.log(
  lines.length,
  Bun.hash(lines.join("\n")).toString(16),
  describe(Object.getPrototypeOf(heir)),
  kept.map(describe).join(" | "),
);
for (let i = 0; i < lines.length; i += 97) console.log(lines[i]);
