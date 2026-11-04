// The value that a switch compares its cases with is read once, before the first case. A case expression that stores into the variable changes nothing of that.
const say = (...values) => console.log(...values);

function parameter(value, other) {
  switch (value) {
    case (value = 5, 1.1): return "first";
    case other: return "matched";
  }
  return "none";
}
say(parameter(undefined, undefined), parameter(1.1, 0), parameter(5, 5), parameter(5, 6));

function local(start) {
  let value = start;
  switch (value) {
    case value++ + 10: return "first " + value;
    case start: return "matched " + value;
    case start + 1: return "the stored value " + value;
  }
  return "none " + value;
}
say(local(1), local(-10));

function storedByCall(start) {
  let value = start;
  const change = () => { value = "changed"; return "never"; };
  switch (value) {
    case change(): return "first";
    case "changed": return "the stored value";
    case start: return "matched " + value;
  }
  return "none";
}
say(storedByCall("kept"));

function behindDefault(value) {
  switch (value) {
    case (value += 1, "no"): return "first";
    default: return "default " + value;
    case 7: return "seven " + value;
  }
}
say(behindDefault(7), behindDefault(6), behindDefault(0));

function destructured(value) {
  switch (value) {
    case ([value] = [9], 0): return "first";
    case 3: return "three " + value;
    case 9: return "the stored value";
  }
  return "none";
}
say(destructured(3), destructured(9), destructured(0));

function inLoop() {
  const seen = [];
  for (let value = 0; value < 4; value++) {
    switch (value) {
      case (value === 1 ? (value = 2, -1) : -1): seen.push("first"); break;
      case 1: seen.push("one, now " + value); break;
      case 2: seen.push("two"); break;
      default: seen.push("other " + value);
    }
  }
  return seen.join();
}
say(inLoop());

let atTheTop = "top";
switch (atTheTop) {
  case (atTheTop = "stored", "no"): say("first"); break;
  case "stored": say("the stored value"); break;
  case "top": say("matched", atTheTop); break;
}
