function show(value) {
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol" || typeof value === "function") return value.toString();
  return typeof value === "object" || typeof value === "string" ? JSON.stringify(value) : String(value);
}

function outcome(f, args) {
  try {
    return show(f(...args));
  } catch (error) {
    return "threw " + error;
  }
}

// Warms the function up with each list of arguments in turn, and then tries it with all of them. What it is expected
// to do comes from copies that run once.
function check(f, lists) {
  const copy = () => (0, eval)(`(${f})`);
  const expected = lists().map(args => outcome(copy(), args));
  for (let warm = 0; warm < expected.length; warm++) {
    const hot = copy();
    for (let turn = 0; turn < 40; turn++) outcome(hot, lists()[warm]);
    for (let round = 0; round < 2; round++) {
      lists().forEach((args, index) => {
        const actual = outcome(hot, args);
        if (actual !== expected[index])
          throw new Error(`${f}\nwarm ${warm}, arguments ${index}: ${actual} instead of ${expected[index]}`);
      });
    }
  }
}

// Goes through the lists again and again, so that the function is compiled anew for more and more types.
function checkInTurn(f, lists, rounds = 14) {
  const copy = () => (0, eval)(`(${f})`);
  const expected = lists().map(args => outcome(copy(), args));
  const hot = copy();
  for (let round = 0; round < rounds; round++) {
    lists().forEach((args, index) => {
      const actual = outcome(hot, args);
      if (actual !== expected[index])
        throw new Error(`${f}\nround ${round}, arguments ${index}: ${actual} instead of ${expected[index]}`);
    });
  }
}

// For `check`: makes a list of arguments only when it is asked for.
const lazily = (items, make) => () =>
  new Proxy(items, { get: (all, key) => (typeof key === "string" && key >= 0 ? make(all[key]) : all[key]) });
// What `expectFulfilled` has been given is settled by the time that this is called.
let finish = () => {};
function expectFulfilled(promise) {
  const failWith = error => (finish = () => { throw error; });
  failWith(new Error("still pending"));
  promise.then(() => (finish = () => {}), failWith);
}

const values = () => [
  0, -0, 1, -1, 7, 2147483647, -2147483648, 2 ** 32, 2 ** 53, 0.5, -0.5, NaN, Infinity,
  true, undefined, null, "", "7", "ab" + String(Math.min(1, 2)), 3n, {}, [5], { valueOf: () => 2 },
];
const singles = () => values().map(a => [a]);
const pairs = () => values().map((a, index, all) => [a, all[(index * 7 + 3) % all.length]]).concat(values().map(a => [a, a]));
const joined = (...parts) => parts.reduce((all, it) => all + it, "");
const inside = (text, around) => joined(around, text, around).toString().substring(around.length, around.length + text.length);
const strings = () => ["abcabc", "", "a,b", joined("ab", "cab", "c"), inside("bcabc", "xy"), inside("cab", "日"), "a日b", " 12 ", "😀"];
const stringlike = () => strings().concat(5, undefined, { toString: () => "b" });
const across = (first, second) => () => second().map(it => [first()[0], it]).concat(first().map(it => [it, second()[0]]));
const oneOf = make => () => make().map(it => [it]);
