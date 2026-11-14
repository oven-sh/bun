// a fresh record of plain values is read under a key that is an object, whose conversion stores into a variable that is read behind the lookup; and under a symbol
let last = "start";
function pick(key) {
  const table = { a: 1, b: 2 };
  last = "before";
  const found = table[key];
  return found + ":" + last;
}
const converts = { toString() { last = "converted"; return "b"; } };
const throws = { [Symbol.toPrimitive]() { last = "threw"; throw new RangeError("no key"); } };
function tell(key) { try { return pick(key); } catch (e) { return e.name + ":" + last; } }
for (let turn = 0; turn < 3; turn++)
  console.log(tell("a"), tell(converts), tell(throws), tell(Symbol.iterator), tell(1), tell(null), tell(10n));
