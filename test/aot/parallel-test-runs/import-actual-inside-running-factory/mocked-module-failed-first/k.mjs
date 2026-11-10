(globalThis.log ??= []).push("k");
let n = 0;
export const x = "real";
export const bump = () => ++n;
export const count = () => n;
if (!globalThis.asked) {
  globalThis.asked = true;
  throw new RangeError("own");
}
