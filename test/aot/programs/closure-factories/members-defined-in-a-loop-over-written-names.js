// Members that a loop over written names defines: getters, setters and methods, each of which holds the name of its turn.
const above = {};
for (const name of ["a", "b", "c"]) {
  Object.defineProperty(above, name, {
    get() {
      return this.inner[name];
    },
    set(value) {
      this.inner[name] = value;
    },
    configurable: true,
  });
}
const below = Object.create(above);
below.inner = { a: 1, b: 2, c: 3 };
below.b = 20;
console.log(below.a, below.b, below.c, JSON.stringify(below.inner), Object.getOwnPropertyNames(above).join());

const methods = {};
for (const name of ["first", "second", "first"]) {
  methods[name] = function (x) {
    return name + ":" + x;
  };
}
console.log(
  methods.first(1),
  methods.second(2),
  methods.first.name,
  methods.first.length,
  methods.first === methods.second,
);
console.log(String(methods.first) === String(methods.second), Object.keys(methods).join());

// A turn that leaves the loop, one that goes on early, and one that throws.
const some = {};
let turns = 0;
try {
  for (const name of ["skipped", "kept", "thrown", "never"]) {
    turns++;
    if (name === "skipped") continue;
    if (name === "thrown") throw new Error("in the turn of " + name);
    some[name] = () => name;
  }
} catch (error) {
  console.log(error.message, turns, Object.keys(some).join(), some.kept());
}
for (const name of ["one", "two", "three"]) {
  some[name] = () => name;
  if (name === "two") break;
}
console.log(Object.keys(some).join(), some.one(), some.two());

// A member is defined anew by a later loop, and read through an object below.
for (const name of ["a", "c"]) {
  Object.defineProperty(above, name, {
    get() {
      return "again " + name;
    },
    configurable: true,
  });
}
console.log(below.a, below.b, below.c);

// The loop stands in a function that runs many times.
function make(prefix) {
  const made = {};
  for (const name of ["p", "q"]) made[name] = () => prefix + name;
  return made;
}
console.log(make("1").p(), make("2").q(), make("3").p !== make("3").p);

// The names are handed to a function, one call each.
const each = {};
["x", "y"].forEach((name, index, all) => {
  each[name] = () => name + index + all.length;
});
console.log(each.x(), each.y(), Object.keys(each).join());
const mapped = ["m", "n", "m"].map(function (name) {
  each[name] = function () {
    return [name, this === each];
  };
  return each[name];
});
console.log(mapped.length, mapped[0] === mapped[2], mapped[2] === each.m, each.m().join(), each.n().join());

// The function is kept and called with a name that is not among the written ones, and with what is no name.
let kept;
["k"].forEach(
  (kept = name => {
    each[name] = () => typeof name + ":" + String(name);
  }),
);
kept("later");
kept(7);
kept();
console.log(each.k(), each.later(), each[7](), each.undefined());

// The first parameter is not the name.
const sum = ["r", "s"].reduce((all, name) => {
  all[name] = () => name;
  return all;
}, {});
console.log(sum.r(), sum.s());

// The names are held by a constant, which is changed between two loops over it.
const names = ["u", "v"];
const held = {};
for (const name of names) held[name] = () => name;
names.push("w");
names[0] = "changed";
names.forEach(name => {
  held[name] = () => name + "!";
});
console.log(Object.keys(held).join(), held.u(), held.v(), held.w(), held.changed());

// A turn hands its name to a function that defines the member.
const defined = {};
function define(target, name, times) {
  target[name] = () => name.repeat(times);
}
for (const name of ["f", "g", "f"]) define(defined, name, Object.keys(defined).length + 1);
console.log(Object.keys(defined).join(), defined.f(), defined.g());
