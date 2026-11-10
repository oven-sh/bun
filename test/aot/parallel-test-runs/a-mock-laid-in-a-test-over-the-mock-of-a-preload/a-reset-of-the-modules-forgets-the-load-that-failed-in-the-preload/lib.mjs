export const a = 1;
if (!globalThis.hasThrown) {
  globalThis.hasThrown = true;
  throw new RangeError("made up");
}
