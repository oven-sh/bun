// A rest array of more than four values lies in the frame of the module's body, which is saved at the await. The output is that of plain Bun.
const say = (...values) => console.log(...values);
say(1, "b", 3, "d", 5, "f", 7);
await null;
say("after", "the", "await", 4, 5, 6);
async function later(...values) {
  say(...values, "before", 1, 2, 3, 4);
  await null;
  say(...values, "behind", 1, 2, 3, 4);
  return values.length;
}
say(await later("x", "y"), await later());
