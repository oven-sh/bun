// Closures of one function add a captured value to what a loop passes them: numbers, strings, objects and values that change.
const box = JSON.parse("{}");
const hide = value => ((box.value = value), box.value);
const adder = step => x => x + step;
const around = step => x => step + x;
const counter = total => x => {
  total = total + 1;
  return x + total;
};
const pair = step => ({ plus: x => x + step, times: x => x * step });
function nested(step) {
  function add(x) {
    return x + step;
  }
  return x => add(x) + 1;
}
let calls = 0;
const steps = {
  one: 1,
  half: 0.5,
  negativeZero: -0,
  large: 2 ** 53,
  int: 2147483647,
  notANumber: NaN,
  string: "s",
  nothing: undefined,
  empty: null,
  yes: true,
  big: 5n,
  object: {
    valueOf() {
      calls++;
      return 3;
    },
  },
  list: [4],
  date: new Date(0).getTime(),
};
const lists = {
  ints: JSON.parse("[1,2,3,4,5,6,7,8]"),
  doubles: JSON.parse("[1.5,2.25,-3,4]"),
  mixed: hide([1, "two", 3, undefined, 2147483647, { toString: () => "o" }]),
  holes: hide([1, , 3, -0]),
  view: Float64Array.from([0.5, 1, NaN]),
};
function sum(f, list) {
  let s = 0;
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < list.length; i++) s = s + f(list[i]);
  }
  return s;
}
function sumOfTwo(f, g, list) {
  let s = 0;
  for (let i = 0; i < list.length; i++) s = (s + (f(list[i]) + g(i))) & 65535;
  return s;
}
function attempt(act) {
  try {
    const result = act();
    return Object.is(result, -0) ? "-0" : typeof result + " " + String(result);
  } catch (error) {
    return error.constructor.name;
  }
}
for (const [name, step] of Object.entries(steps)) {
  for (const [kind, list] of Object.entries(lists)) {
    const f = adder(hide(step));
    const g = around(step);
    const h = counter(step);
    const o = pair(step);
    const n = nested(step);
    const fixed = adder(step);
    const here = () => {
      let s = 0;
      for (let i = 0; i < list.length; i++) s += fixed(list[i]);
      return s;
    };
    const both = () => {
      let s = 0;
      for (let i = 0; i < list.length; i++) s = (s + (o.plus(list[i]) + o.times(list[i]))) & 65535;
      return s;
    };
    const through = () => {
      let s = 0;
      for (const x of list) s = s + n(x);
      return s;
    };
    const counted = () => {
      let s = 0;
      for (let i = 0; i < list.length; i++) s = s + h(list[i]);
      return s;
    };
    console.log(name, kind, [() => sum(f, list), () => sum(g, list), here, both, through, counted, counted, () => sumOfTwo(f, g, list)].map(attempt).join(" | "));
  }
}
console.log(calls);
