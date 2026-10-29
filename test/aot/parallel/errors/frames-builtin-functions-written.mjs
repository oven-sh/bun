// The conversion of an operand throws or takes a stack trace below a built-in function that the engine writes in JavaScript. Each row prints the frames up to `start`.
const framesOf = stack => {
  const frames = String(stack)
    .split("\n")
    .slice(1)
    .map(line => line.trim().replace(/^at /, ""))
    .map(frame => (frame.includes(" (") ? frame.replace(/\(.*?([a-z]*)(:\d+:\d+)?\)$/, "($1$2)") : "(file)"))
    .map(frame => frame.replace(/native:\d+:\d+/, "native"));
  const end = frames.findIndex(frame => frame.startsWith("start "));
  return frames.slice(0, end + 1).join(" < ");
};
let seen = "";
function look() {
  seen = framesOf(new Error().stack);
  return undefined;
}
function fail() {
  throw new RangeError("thrown below");
}
function start(run, act) {
  seen = "";
  try {
    const result = run(act);
    return seen + " | " + typeof result;
  } catch (error) {
    return error.name + " | " + framesOf(error.stack);
  }
}
const key = act => ({
  toString() {
    act();
    return "a";
  },
});
const number = act => ({
  valueOf() {
    act();
    return 1;
  },
});
const rows = {
  reflectGet: act => Reflect.get({ a: 1 }, key(act)),
  reflectGetKept: act => {
    const got = Reflect.get({ a: 1 }, key(act));
    return got;
  },
  reflectGetUnused: act => {
    Reflect.get({ a: 1 }, key(act));
  },
  reflectGetWithReceiver: act => Reflect.get({ a: 1 }, key(act), {}),
  reflectGetInTry: act => {
    try {
      return Reflect.get({ a: 1 }, key(act));
    } finally {
      seen += "";
    }
  },
  reflectGetReturned(act) {
    return Reflect.get({ a: 1 }, key(act));
  },
  reflectHas: act => Reflect.has({ a: 1 }, key(act)),
  reflectHasKept: act => {
    const has = Reflect.has({ a: 1 }, key(act));
    return has;
  },
  reflectHasTested: act => (Reflect.has({ a: 1 }, key(act)) ? 1 : 2),
  fromEntries: act => Object.fromEntries([[key(act), 1]]),
  fromEntriesKept: act => {
    const made = Object.fromEntries([[key(act), 1]]);
    return made;
  },
  fromEntriesUnused: act => {
    Object.fromEntries([[key(act), 1]]);
  },
  fromEntriesSecond: act =>
    Object.fromEntries([
      ["b", 1],
      [key(act), 2],
    ]),
  fromEntriesMember: act => Object.fromEntries([[key(act), 1]]).a,
  fromEntriesOfCopy: act => Object.fromEntries([[key(act), 1]].slice()),
  fromEntriesOfMap: act => Object.fromEntries(new Map([[key(act), 1]])),
  padStart: act => "a".padStart(number(act)),
  padEnd: act => "a".padEnd(number(act), "b"),
  arrayFrom: act => Array.from({ length: number(act) }),
  arrayFill: act => [1, 2].fill(0, number(act)),
  arrayCopyWithin: act => [1, 2].copyWithin(number(act), 0),
  arrayFlat: act => [[1]].flat(number(act)),
  arrayAt: act => [1, 2].at(number(act)),
  typedArrayFill: act => new Uint8Array(2).fill(number(act)),
  typedArraySubarray: act => new Uint8Array(2).subarray(number(act)),
};
for (const name in rows) {
  console.log(name, "looks:", start(rows[name], look));
  console.log(name, "fails:", start(rows[name], fail));
}
