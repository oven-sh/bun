// Lists are made with a length that no list has, under the name Array, under other names and by Array.from, and filled or mapped behind that.
// Each row prints the frames, and the place of each that is not of a built-in function. The stack lists Array where the text calls it.
const framesIn = stack =>
  String(stack)
    .split("\n")
    .slice(1)
    .map(line =>
      line
        .trim()
        .replace(/^at /, "")
        .replace(/(?:[A-Z]:)?[\\/].*[\\/]/, "")
        .replace(/native:\d+:\d+/, "native"),
    )
    .join(" < ");
const Other = Array;
const holder = { Array };

const rows = {
  free(length) {
    const list = Array(length).fill(0);
    return list;
  },
  freeWithNew(length) {
    const list = new Array(length).fill(0);
    return list;
  },
  ofTheGlobalObject(length) {
    const list = globalThis.Array(length).fill(0);
    return list;
  },
  ofTheGlobalObjectWithNew(length) {
    const list = new globalThis.Array(length).fill(0);
    return list;
  },
  underAnotherName(length) {
    const list = Other(length).fill(0);
    return list;
  },
  underAnotherNameWithNew(length) {
    const list = new Other(length).fill(0);
    return list;
  },
  underANameUsedOnce(length) {
    const Named = Array;
    const list = Named(length);
    return list;
  },
  underANameUsedOnceWithNew(length) {
    const Named = Array;
    const list = new Named(length);
    return list;
  },
  underANameUsedOnceAndFilled(length) {
    const Named = Array;
    const list = Named(length).fill(0);
    return list;
  },
  underANameUsedTwice(length) {
    const Named = Array;
    const list = Named(length);
    return [list, Named];
  },
  underANameUsedTwiceWithNew(length) {
    const Named = Array;
    const list = new Named(length).fill(0);
    return [list, Named];
  },
  memberOfAnObject(length) {
    const list = holder.Array(length).fill(0);
    return list;
  },
  memberOfAnObjectWithNew(length) {
    const list = new holder.Array(length).fill(0);
    return list;
  },
  ofTheGlobalObjectMapped(length) {
    const list = globalThis
      .Array(length)
      .fill(0)
      .map(value => value);
    return list;
  },
  ofTheGlobalObjectWithNewMapped(length) {
    const list = new globalThis.Array(length).fill(0).map(value => value);
    return list;
  },
  underAnotherNameMapped(length) {
    const list = Other(length)
      .fill(0)
      .map(value => value);
    return list;
  },
  underAnotherNameMappedInTailPosition(length) {
    return new Other(length).fill(0).map(value => value);
  },
  ofTheGlobalObjectBehindACall(length) {
    const list = globalThis.Array(length).fill(String(length));
    return list;
  },
  behindAComma(length) {
    const list = (0, Array)(length).fill(0);
    return list;
  },
  behindACommaAlone(length) {
    const list = (0, Array)(length);
    return list;
  },
  behindACommaInTailPosition(length) {
    return (0, Array)(length);
  },
  spread(length) {
    const list = Array(...[length]);
    return [list];
  },
  spreadWithNew(length) {
    const list = new Array(...[length]);
    return [list];
  },
  spreadWithNewInTailPosition(length) {
    return new Array(...[length]);
  },
  unused(length) {
    Array(length);
    return "nothing thrown";
  },
  unusedWithNew(length) {
    new Array(length);
    return "nothing thrown";
  },
  unusedAndFilled(length) {
    Array(length).fill(0);
    return "nothing thrown";
  },
  unusedOfTheGlobalObject(length) {
    globalThis.Array(length);
    return "nothing thrown";
  },
  from(length) {
    const list = Array.from({ length });
    return list;
  },
  fromMapped(length) {
    const list = Array.from({ length }, value => value);
    return list;
  },
  fromMappedInTailPosition(length) {
    return Array.from({ length }, value => value);
  },
};

for (const length of [-1, 1.5, 2 ** 32, 2 ** 53]) {
  for (const [name, row] of Object.entries(rows)) {
    let shown;
    try {
      shown = String(row(length)).slice(0, 20);
    } catch (error) {
      const frames = framesIn(error.stack);
      const place = /^[^<]*\(native\)/.test(frames) ? "a built-in function" : `${error.line}:${error.column}`;
      shown = `${error.name}: ${error.message} at ${place} < ${frames}`;
    }
    console.log(`${name} ${length}: ${shown}`);
  }
}
