// push() of more than four values onto a list that compiled code knows nothing about. A list with room takes them in place; every other receiver goes the way of the function.
const show = v => (Array.isArray(v) ? "[" + Array.from({ length: v.length }, (_, i) => (Object.hasOwn(v, i) ? show(v[i]) : "_")).join() + "]" : Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : typeof v === "symbol" ? "symbol" : v && typeof v === "object" ? "{" + Object.keys(v).join() + "}" : String(v));
const line = (...all) => console.log(all.map(show).join(" "));
const five = (list, a) => list.push(" ", a, '="', a, '"');
const six = (list, a) => list.push(a, 1, 2.5, null, undefined, -0);
const nine = (list, a) => list.push(a, 1, 2, 3, 4, 5, 6, 7, 8);
function eighteen(list, a) {
  list.push(a, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, a);
  return list.length;
}
const attempt = (f, list, a) => {
  try {
    return f(list, a);
  } catch (e) {
    return e.constructor.name;
  }
};

// Lists of strings that grow: in place while there is room, by the function where there is none.
for (const f of [five, six, nine, eighteen]) {
  const list = [];
  let sum = 0;
  for (let i = 0; i < 60; i++) sum += f(list, "n" + i);
  line(list.length, sum, list.slice(0, 12), list.slice(-3), list[list.length >> 1]);
}

// What the values are: the list itself, objects that live on through a collection, numbers into a list of numbers.
const keep = ["kept"];
for (let i = 0; i < 2000; i++) {
  keep.push({ i }, [i], "s" + i, i, i * 0.5);
  if (keep.length > 900) keep.length = 1;
  if (i % 500 === 0 && typeof Bun !== "undefined") Bun.gc(true);
}
line(keep.length, keep.filter(v => v && typeof v === "object").length, keep[1].i, keep[2]);
const own = ["x"];
own.push(own, own, own.length, own, "end");
line(own.length, own[1] === own, own[3], own[5]);
const numbers = [1, 2, 3];
line(six(numbers, 4), numbers, nine([0.5], 1.5), five([1, 2], 3));

// Other receivers.
const receivers = [
  () => Object.freeze(["f"]),
  () => Object.seal(["s"]),
  () => Object.preventExtensions(["p", 1, 2]),
  () => Object.defineProperty(["r"], "length", { writable: false }),
  () => ["a", , "b"],
  () => new Array(3),
  () => Object.assign(["e"], { extra: 1 }),
  () => new (class List extends Array {})(),
  () => Object.setPrototypeOf(["n"], { __proto__: Array.prototype, push: Array.prototype.push }),
  () => ({ length: 2, push: Array.prototype.push }),
  () => ({ length: 2 ** 53 - 3, push: Array.prototype.push }),
  () => ({ push: (...all) => "own" + all.length }),
  () => new Proxy(["t"], { set: (t, k, v) => Reflect.set(t, k, v) }),
  () => "text",
  () => null,
];
for (const make of receivers) {
  for (const f of [five, nine, eighteen]) {
    const list = make();
    const answer = attempt(f, list, "v");
    line(answer, Array.isArray(list) ? list.slice(0, 7) : list && typeof list === "object" ? list.length : list, Array.isArray(list) ? list.length : 0);
  }
}

// call(), apply(), Reflect.apply() and spread.
const all = ["z"];
line(Array.prototype.push.call(all, 1, 2, 3, 4, 5), Array.prototype.push.apply(all, ["a", "b", "c", "d", "e", "f"]), Reflect.apply(all.push, all, [1, 2, 3, 4, 5, 6, 7]), all.push(...all, "w", "x"), all);

// Another function under the name, and an accessor above a list.
const original = Array.prototype.push;
const replaced = ["q"];
replaced.push = function (...values) {
  return "mine" + values.length;
};
line(five(replaced, 1), replaced, original.call(replaced, 1, 2, 3, 4, 5));
const above = Object.create(Array.prototype, {
  7: {
    set(v) {
      line("set", v);
    },
    get() {
      return "above";
    },
  },
});
const below = Object.setPrototypeOf(["b"], above);
line(nine(below, 0), below.length, below[7], Object.hasOwn(below, 7));
const plain = ["c"];
line(nine(plain, 0), plain.length, plain[7]);
