// Prints the frames of errors that a getter throws while an object literal copies the object that has it. The spread stands behind another member of the literal, and in most forms its operand begins with a
// parenthesis.
const lib = {
  trap() {
    return {
      get value() {
        throw new Error("trap");
      },
    };
  },
};
const other = lib;
const flag = Date.now() > 0;
const take = (...values) => values.length;
const forms = [
  () => ({ first: 1, ...(flag ? lib : other).trap() }),
  () => ({ first: 1, ...lib.trap() }),
  () => ({ first: lib, ...(flag ? lib : other).trap() }),
  () => ({ first: take(1), ...(flag ? lib : other).trap() }),
  () => ({ first: 1, second: "two", ...(lib ?? other).trap() }),
  () => ({ first: 1, ...(0, lib.trap)() }),
  () => ({ ...other, ...(flag ? lib : other).trap() }),
  () => ({ first() {}, ...(flag ? lib : other).trap() }),
  () => ({ lib, ...(flag ? lib : other).trap() }),
  () => ({ [flag]: 1, ...(flag ? lib : other).trap() }),
  () => ({ first: 1, ...(flag ? lib : other).trap(), last: 2 }),
  () => ({ first: [1, 2], ...(flag ? lib : other).trap() }),
  () => ({ first: { inner: 1 }, ...(flag ? lib : other).trap() }),
  () => ({ first: 1, ...(flag ? lib.trap() : other) }),
  () => ({ first: lib.trap, ...(flag ? lib : other).trap() }),
  () => ({ first: () => 1, ...(flag ? lib : other).trap() }),
  () => ({ first: -take(), ...(flag ? lib : other).trap() }),
  () => ({ first: `a${flag}`, ...(flag ? lib : other).trap() }),
  () => ({ first: new Map(), ...(flag ? lib : other).trap() }),
  () => ({ first: flag ? 1 : 2, ...(flag ? lib : other).trap() }),
  () => ({ first: 1 + take(), ...(flag ? lib : other).trap() }),
  () => ({
    get first() {
      return 1;
    },
    ...(flag ? lib : other).trap(),
  }),
  () => ({
    first: 1,
    ...(flag ? lib : other).trap(),
  }),
  () => ({ ...other, first: 1, ...(flag || lib).constructor, ...(flag ? lib : other).trap() }),
  async () => ({ first: 1, ...(await lib).trap() }),
];
let index = 0;
for (const form of forms) {
  index++;
  try {
    await form();
    console.log(index, "no error");
  } catch (error) {
    const frames = error.stack.split("\n").filter(line => /\.mjs:/.test(line));
    console.log(
      index,
      frames.map(line => line.replace(/^\s*at /, "").replace(/\(?[^ ()]*\.mjs:(\d+:\d+)\)?/, "$1")).join(" < "),
    );
  }
}
