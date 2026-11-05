// Open classes seen in the middle of construction.
import * as typed from "./core.ts";
import * as untyped from "./untyped.js";
import { kept, probe } from "./probes.js";

function say(name: string, f: () => unknown) {
  let text: string;
  try {
    text = JSON.stringify(f()) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name + ": " + (error as Error).message;
  }
  console.log(name + ": " + text);
}
const whole = (made: object) => [Object.keys(made).join(), JSON.stringify(made)];

say("seen by untyped code", () => {
  const made = new untyped.HeirOfCore(5);
  return [whole(made), typed.sumOfCore(made)];
});
say("seen by typed code", () => {
  const made = new untyped.HeirOfSeenByTypedCode();
  return [whole(made), typed.sumOfSeenByTypedCode(made)];
});
say("a typed heir between", () => {
  const made = new untyped.HeirOfMiddle();
  return [whole(made), typed.sumOfMiddle(made)];
});
say("a throw in the middle", () => {
  try {
    new untyped.HeirOfThrows();
  } catch (error) {
    const half = kept[kept.length - 1];
    return [(error as Error).message, whole(half), "c" in half, "d" in half, typed.sumOfThrows(half)];
  }
});
say("seen in the constructor's body", () => {
  const made = new untyped.HeirOfInTheConstructor();
  return [whole(made), typed.sumOfInTheConstructor(made)];
});
say("initializers that name functions", () => {
  const made = new untyped.HeirOfNamesAFunction();
  return [Object.keys(made).join(), typed.sumOfNamesAFunction(made), made.named === typed.probeTyped, made.imported === probe];
});
say("fields are defined, not set", () => {
  const made = new untyped.HeirOfDefinedNotSet();
  return [whole(made), untyped.calls, typed.sumOfDefinedNotSet(made), Object.getOwnPropertyDescriptor(made, "bare")];
});
say("made by typed code and extended by untyped code", () => {
  const made = new untyped.HeirOfBoth();
  return [whole(typed.makeBoth()), whole(made), typed.sumOfBoth(made), typed.sumOfBoth(typed.makeBoth())];
});
say("seventy-four fields", () => {
  const made = new untyped.HeirOfWide();
  return [Object.keys(made).length, made.f30, made.f70, typed.sumOfWide(made), Object.keys(made).slice(28, 33).join()];
});
say("many", () => {
  let length = 0;
  for (let i = 0; i < 2000; ++i) length += new untyped.HeirOfCore(i).g.length + new untyped.HeirOfMiddle().n.length;
  return length;
});
