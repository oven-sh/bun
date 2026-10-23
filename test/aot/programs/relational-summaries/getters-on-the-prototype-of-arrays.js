// An array that a helper only reads can still run code: a hole is looked up on the prototype chain, where an index may be an accessor; an heir of Array overrides what built-ins and loops ask for; one array gets a prototype, an accessor or an iterator of its own.
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const kept = [];
function second(list) {
  return list[1];
}
function sum(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i] === undefined ? 0 : list[i];
  return total;
}
function sumByOf(list) {
  let total = 0;
  for (const x of list) total += x === undefined ? 0 : x;
  return total;
}
function firstTwo(list) {
  const [a, b] = list;
  return a + "," + b;
}
function spreadOut(list) {
  return Math.max(...list);
}
function store(list, i, value) {
  list[i] = value;
  return list.length;
}
let warm = 0;
for (let i = 0; i < 1000; i++) warm += second([i, i + 1, i + 2]) + sum([i, 1, 2]) + sumByOf([i, 1]) + firstTwo([i, 2]).length + spreadOut([i, 3]) + store([1, 2], 1, i);
console.log(warm);

// A prototype between the array and Array.prototype, with an accessor under an index.
const between = Object.create(Array.prototype, {
  1: {
    get() {
      kept.push(this);
      return 500;
    },
    set(value) {
      kept.push(this, value);
    },
    configurable: true,
  },
});
function holey(tag) {
  const list = [1, , 3];
  list.tag = tag;
  return Object.setPrototypeOf(list, between);
}
console.log(second(holey("second")), sum(holey("sum")), sumByOf(holey("of")), firstTwo(holey("destructured")), spreadOut(holey("spread")), holey("join").join(), holey("includes").includes(500), holey("indexOf").indexOf(500), JSON.stringify(holey("json")));
console.log(store(holey("store"), 1, { tag: "the stored value" }), churn(40), kept.map(k => k.tag).join(" | "));
kept.length = 0;

// An accessor on the array itself.
function withOwnAccessor(tag) {
  const list = [1, 2, 3];
  list.tag = tag;
  return Object.defineProperty(list, 1, {
    get() {
      kept.push(this);
      return 700;
    },
  });
}
console.log(second(withOwnAccessor("own second")), sum(withOwnAccessor("own sum")), sumByOf(withOwnAccessor("own of")), firstTwo(withOwnAccessor("own destructured")), withOwnAccessor("own map").map(x => x + 1).join(), withOwnAccessor("own slice").slice(1).join(), [0].concat(withOwnAccessor("own concat")).join());
console.log(churn(40), kept.map(k => k.tag).join(" | "));
kept.length = 0;

// An heir of Array.
class Spying extends Array {
  get length() {
    return super.length;
  }
  [Symbol.iterator]() {
    kept.push(this);
    return super[Symbol.iterator]();
  }
  static get [Symbol.species]() {
    kept.push("species");
    return Array;
  }
}
function spying(tag) {
  const list = Spying.from([4, 5, 6]);
  kept.length = 0;
  list.tag = tag;
  return list;
}
const report = () => kept.splice(0).map(k => k.tag ?? k).join("+");
console.log(sumByOf(spying("heir of")), report(), firstTwo(spying("heir destructured")), report(), spreadOut(spying("heir spread")), report(), sum(spying("heir by index")), report());
console.log(spying("heir map").map(x => x * 2).join(), report(), spying("heir filter").filter(x => x > 4).constructor.name, report(), Array.from(spying("heir from")).join(), report(), new Set(spying("heir set")).size, report());

// One array with an iterator of its own.
function withOwnIterator(tag) {
  const list = [7, 8, 9];
  list.tag = tag;
  list[Symbol.iterator] = function* () {
    kept.push(this);
    yield 70;
    yield 80;
  };
  return list;
}
console.log(sumByOf(withOwnIterator("own iterator of")), firstTwo(withOwnIterator("own iterator destructured")), spreadOut(withOwnIterator("own iterator spread")), sum(withOwnIterator("by index")), [...withOwnIterator("literal spread")].join(), report());

// Fresh arrays on a rare path of a hot loop.
let mixed = 0;
for (let i = 0; i < 400; i++) {
  mixed += second(i % 150 === 149 ? holey("rare hole " + i) : [i, 1, 2]);
  mixed += sumByOf(i % 150 === 148 ? withOwnIterator("rare iterator " + i) : [i, 1]);
  mixed += sum(i % 150 === 147 ? withOwnAccessor("rare accessor " + i) : [i, 1, 2]);
}
console.log(mixed, churn(60), report());

// Things that are no arrays where an array was read.
console.log(second("text"), second({ 1: "object" }), second(new Uint8Array([1, 2])), sum({ length: 2, 0: 5, 1: 6 }), sumByOf(new Set([1, 2])), firstTwo("ab"), firstTwo(new Map([[1, 2]]).keys()), sum("12"), second(arguments_(1, 2)));
function arguments_() {
  return arguments;
}

// The length is written, elements are deleted, the array is frozen: by a helper that the caller took for a reader.
function touch(list, how) {
  if (how === 1) list.length = 1;
  if (how === 2) delete list[0];
  if (how === 3) Object.freeze(list);
  if (how === 4) list.reverse();
  if (how === 5) list.sort((a, b) => b - a);
  if (how === 6) list.copyWithin(0, 1);
  if (how === 7) Array.prototype.push.call(list, 99);
  if (how === 8) Object.defineProperty(list, "length", { writable: false });
  return list[0];
}
const states = [];
for (let i = 0; i < 300; i++) {
  const how = i >= 290 ? i - 290 : 0;
  const list = [1, 2, 3];
  const first = touch(list, how);
  let pushed;
  try {
    pushed = list.push(4);
  } catch (error) {
    pushed = error.constructor.name;
  }
  if (i >= 290) states.push(first + ":" + list.join("/") + ":" + pushed);
}
console.log(states.join(" "));
