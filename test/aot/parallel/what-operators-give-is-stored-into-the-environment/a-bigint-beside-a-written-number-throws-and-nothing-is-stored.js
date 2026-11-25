// A bigint and a number do not mix: the operator throws in front of the store, whether the bigint is there or comes out of valueOf().
const big = BigInt(JSON.parse("1"));
for (const left of [big, { valueOf: () => big }, Symbol.for("made up")]) {
  try {
    process.env.MADE_UP_MIX = left + 1;
  } catch (error) {
    console.log(error.name);
  }
}
console.log(process.env.MADE_UP_MIX);
