// A rest array of more than four values lies in the frame of the module's body, which is saved at the await. A build that checks itself spoils the array in front of the await,
// and what it needs for that may not look like an address that is kept across it: such a build failed with FrameAddressAcrossSuspension. The output is that of plain Bun.
// Flags: --aot-validate
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
