// Lists are made with Array(n).fill(v) and Array(n).fill(v).map(f). The mapper takes a stack trace or throws, or the length is one that no list has.
// Each row prints the frames, and the place of each that is not of a built-in function.
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
const frames = () => framesIn(new Error("taken").stack);
let calls = 0;
const next = () => calls++;

const rows = {
  mapped() {
    const list = new Array(1).fill(0).map(() => frames());
    return list[0];
  },
  mappedInTailPosition() {
    return new Array(1).fill(0).map(() => frames());
  },
  mappedThenReturned() {
    const list = new Array(1).fill(0).map(() => frames());
    return list;
  },
  mappedWithoutNew() {
    const list = Array(2)
      .fill(0)
      .map((value, index) => (index ? "" : frames()));
    return list[0];
  },
  mapperThrows() {
    const list = new Array(3).fill(1).map(value => {
      throw new Error("from the mapper " + value);
    });
    return list.length;
  },
  mappedOverAText(length = "a") {
    const list = new Array(length).fill(0).map(() => frames());
    return list[0];
  },
  mappedNegative(length = -1) {
    const list = new Array(length).fill(0).map(() => frames());
    return list.length;
  },
  mappedNegativeInTailPosition(length = -1) {
    return new Array(length).fill(0).map(() => frames());
  },
  mappedFraction(length = 1.5) {
    const list = Array(length)
      .fill(0)
      .map(() => frames());
    return list.length;
  },
  mappedNegativeBehindACall(length = -1) {
    const list = Array(length)
      .fill(next())
      .map(value => value);
    return list.length;
  },
  filledNegative(length = -1) {
    const list = new Array(length).fill(0);
    return list.length;
  },
  filledNegativeInTailPosition(length = -1) {
    return new Array(length).fill(0);
  },
  filledNotANumber(length = NaN) {
    const list = Array(length).fill("");
    return list.length;
  },
  filledNegativeBehindACall(length = -1) {
    const list = new Array(length).fill(next());
    return list.length;
  },
};

for (const [name, row] of Object.entries(rows)) {
  let shown;
  try {
    shown = String(row());
  } catch (error) {
    shown = `${error.name}: ${error.message} at ${error.line}:${error.column} < ${framesIn(error.stack)}`;
  }
  console.log(`${name}: ${shown} (${calls} calls)`);
}
