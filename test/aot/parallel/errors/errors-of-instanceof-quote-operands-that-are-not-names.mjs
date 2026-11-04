// `instanceof` of a right side that is no function: the message quotes both operands, also when they are more than names.
function tell(label, run) {
  try {
    console.log(label + ": " + run());
  } catch (error) {
    console.log(label + ": " + error.message);
  }
}
const notAFunction = {};
const noHasInstance = { [Symbol.hasInstance]: 5 };
const t = { f: () => Promise.resolve(1), g: () => notAFunction, h: () => noHasInstance };
function g() {
  return {};
}
tell("literal on the left", () => ({}) instanceof notAFunction);
tell("call on the left", () => g() instanceof notAFunction);
tell("call on the right", () => notAFunction instanceof g());
tell("calls on both sides", () => g() instanceof t.g());
tell("Symbol.hasInstance", () => g() instanceof t.h());
tell("member of a call", () => g(1)[1] instanceof t.g());
tell("in a condition", () => (g() instanceof t.g() ? 1 : 2));
tell("behind &&", () => g() && g() instanceof t.g());
tell("twice alike", () => [g() instanceof Object, g() instanceof t.g()]);
tell("two places", () => {
  const a = g() instanceof Object;
  const b = t.g() instanceof Object;
  return a && b && t.g() instanceof t.h();
});
tell("not", () => !g() instanceof t.g());
tell("string on the left", () => "a" instanceof t.g());
tell("comma on the right", () => g() instanceof (1, t.g()));
tell("logical on the right", () => g() instanceof (null || t.g()));
tell("conditional on the right", () => g() instanceof (g() ? t.g() : 1));
tell("assignment on the right", () => {
  let x;
  return g() instanceof (x = t.g());
});
tell("the word in a string", () => g(" instanceof ") instanceof t.g());
tell("arrow on the right", () => g() instanceof (() => 1));
tell("primitive on the right", () => g() instanceof t.f().then);
async function awaited() {
  tell("awaited value", () => 0);
  try {
    return ({}) instanceof (await t.f().then(() => ({})));
  } catch (error) {
    console.log("awaited on the right: " + error.message);
  }
  try {
    return (await g()) instanceof t.g();
  } catch (error) {
    console.log("awaited on the left: " + error.message);
  }
  try {
    return (await g()) instanceof (await t.g());
  } catch (error) {
    console.log("awaited on both sides: " + error.message);
  }
}
await awaited();
