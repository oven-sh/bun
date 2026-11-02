// Several named properties stored to a fresh array one after the other are added by one structure transition. The array ends up as it would store by store.
"use strict";
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
const show = (label, array) => console.log(label + ":", array.length, JSON.stringify(array), "keys", Object.keys(array).join(), "values", Object.keys(array).map(key => String(array[key])).join("|"));
function attempt(label, make) {
  try {
    let array;
    for (let i = 1; i <= 3; i++) array = make(i);
    show(label, array);
  } catch (error) {
    console.log(label + ":", error.name + ": " + error.message);
  }
}

function markInt32(i, input, groups) {
  const array = [i, i + 1, i + 2];
  array.index = i;
  array.input = input;
  array.groups = groups;
  return array;
}
function markDouble(i, input, groups) {
  const array = [i + 0.5, i + 1.5];
  array.index = i;
  array.input = input;
  array.groups = groups;
  return array;
}
function markObjects(i, input, groups) {
  const array = [{ i }, "text", i];
  array.index = i;
  array.input = input;
  array.groups = groups;
  return array;
}
function markEmpty(i, input, groups) {
  const array = [];
  array.index = i;
  array.input = input;
  array.groups = groups;
  return array;
}
function markHoles(i, input, groups) {
  const array = new Array(3);
  array.index = i;
  array.input = input;
  array.groups = groups;
  return array;
}
show("int32", markInt32(1, "a", undefined));
show("double", markDouble(1, "b", null));
show("objects", markObjects(1, "c", "named"));
show("empty", markEmpty(1, "d", 4));
show("holes", markHoles(1, "e", 5));

const survivors = [];
let checksum = 0;
for (let i = 0; i < 20000; i++) {
  const int32 = markInt32(i, "int32", undefined);
  const double = markDouble(i, "double", null);
  const objects = markObjects(i, "objects", { name: i });
  const empty = markEmpty(i, "empty", i);
  const holes = markHoles(i, "holes", i);
  checksum += int32.index + int32[2] + int32.input.length + double.index + double[1] + objects[0].i + objects.groups.name + empty.length + empty.groups + holes.length + holes.index;
  if (i % 5000 === 0) survivors.push(int32, double, objects, empty, holes);
  if (i % 7000 === 6999) collect();
}
collect();
console.log("20000 of each:", checksum);
for (const array of survivors) {
  array.push(1.5, "pushed");
  array.later = array.index + 1;
  show("survivor", array);
}

const taggers = [
  (v, w) => { const a = [v]; a.p0a = v; a.p0b = w; a.p0c = true; return a; },
  (v, w) => { const a = [v]; a.p1a = w; a.p1b = true; a.p1c = null; a.p1d = "text"; return a; },
  (v, w) => { const a = [v]; a.p2a = true; a.p2b = null; a.p2c = "text"; a.p2d = v; a.p2e = w; return a; },
  (v, w) => { const a = [v]; a.p3a = null; a.p3b = "text"; a.p3c = v; a.p3d = w; a.p3e = undefined; a.p3f = v; return a; },
  (v, w) => { const a = [v]; a.p4a = "text"; a.p4b = v; a.p4c = w; a.p4d = undefined; a.p4e = v; a.p4f = w; a.p4g = true; return a; },
  (v, w) => { const a = [v]; a.p5a = v; a.p5b = w; a.p5c = undefined; a.p5d = v; a.p5e = w; a.p5f = true; a.p5g = null; a.p5h = "text"; return a; },
  (v, w) => { const a = [v]; a.p6a = w; a.p6b = undefined; a.p6c = v; return a; },
  (v, w) => { const a = [v]; a.p7a = undefined; a.p7b = v; a.p7c = w; a.p7d = true; return a; },
  (v, w) => { const a = [v]; a.p8a = v; a.p8b = w; a.p8c = true; a.p8d = null; a.p8e = "text"; return a; },
  (v, w) => { const a = [v]; a.p9a = w; a.p9b = true; a.p9c = null; a.p9d = "text"; a.p9e = v; a.p9f = w; return a; },
  (v, w) => { const a = [v]; a.p10a = true; a.p10b = null; a.p10c = "text"; a.p10d = v; a.p10e = w; a.p10f = undefined; a.p10g = v; return a; },
  (v, w) => { const a = [v]; a.p11a = null; a.p11b = "text"; a.p11c = v; a.p11d = w; a.p11e = undefined; a.p11f = v; a.p11g = w; a.p11h = true; return a; },
  (v, w) => { const a = [v]; a.p12a = "text"; a.p12b = v; a.p12c = w; return a; },
  (v, w) => { const a = [v]; a.p13a = v; a.p13b = w; a.p13c = undefined; a.p13d = v; return a; },
  (v, w) => { const a = [v]; a.p14a = w; a.p14b = undefined; a.p14c = v; a.p14d = w; a.p14e = true; return a; },
  (v, w) => { const a = [v]; a.p15a = undefined; a.p15b = v; a.p15c = w; a.p15d = true; a.p15e = null; a.p15f = "text"; return a; },
  (v, w) => { const a = [v]; a.p16a = v; a.p16b = w; a.p16c = true; a.p16d = null; a.p16e = "text"; a.p16f = v; a.p16g = w; return a; },
  (v, w) => { const a = [v]; a.p17a = w; a.p17b = true; a.p17c = null; a.p17d = "text"; a.p17e = v; a.p17f = w; a.p17g = undefined; a.p17h = v; return a; },
  (v, w) => { const a = [v]; a.p18a = true; a.p18b = null; a.p18c = "text"; return a; },
  (v, w) => { const a = [v]; a.p19a = null; a.p19b = "text"; a.p19c = v; a.p19d = w; return a; },
  (v, w) => { const a = [v]; a.p20a = "text"; a.p20b = v; a.p20c = w; a.p20d = undefined; a.p20e = v; return a; },
  (v, w) => { const a = [v]; a.p21a = v; a.p21b = w; a.p21c = undefined; a.p21d = v; a.p21e = w; a.p21f = true; return a; },
  (v, w) => { const a = [v]; a.p22a = w; a.p22b = undefined; a.p22c = v; a.p22d = w; a.p22e = true; a.p22f = null; a.p22g = "text"; return a; },
  (v, w) => { const a = [v]; a.p23a = undefined; a.p23b = v; a.p23c = w; a.p23d = true; a.p23e = null; a.p23f = "text"; a.p23g = v; a.p23h = w; return a; },
  (v, w) => { const a = [v]; a.p24a = v; a.p24b = w; a.p24c = true; return a; },
  (v, w) => { const a = [v]; a.p25a = w; a.p25b = true; a.p25c = null; a.p25d = "text"; return a; },
  (v, w) => { const a = [v]; a.p26a = true; a.p26b = null; a.p26c = "text"; a.p26d = v; a.p26e = w; return a; },
  (v, w) => { const a = [v]; a.p27a = null; a.p27b = "text"; a.p27c = v; a.p27d = w; a.p27e = undefined; a.p27f = v; return a; },
  (v, w) => { const a = [v]; a.p28a = "text"; a.p28b = v; a.p28c = w; a.p28d = undefined; a.p28e = v; a.p28f = w; a.p28g = true; return a; },
  (v, w) => { const a = [v]; a.p29a = v; a.p29b = w; a.p29c = undefined; a.p29d = v; a.p29e = w; a.p29f = true; a.p29g = null; a.p29h = "text"; return a; },
  (v, w) => { const a = [v]; a.p30a = w; a.p30b = undefined; a.p30c = v; return a; },
  (v, w) => { const a = [v]; a.p31a = undefined; a.p31b = v; a.p31c = w; a.p31d = true; return a; },
  (v, w) => { const a = [v]; a.p32a = v; a.p32b = w; a.p32c = true; a.p32d = null; a.p32e = "text"; return a; },
  (v, w) => { const a = [v]; a.p33a = w; a.p33b = true; a.p33c = null; a.p33d = "text"; a.p33e = v; a.p33f = w; return a; },
  (v, w) => { const a = [v]; a.p34a = true; a.p34b = null; a.p34c = "text"; a.p34d = v; a.p34e = w; a.p34f = undefined; a.p34g = v; return a; },
  (v, w) => { const a = [v]; a.p35a = null; a.p35b = "text"; a.p35c = v; a.p35d = w; a.p35e = undefined; a.p35f = v; a.p35g = w; a.p35h = true; return a; },
  (v, w) => { const a = [v]; a.p36a = "text"; a.p36b = v; a.p36c = w; return a; },
  (v, w) => { const a = [v]; a.p37a = v; a.p37b = w; a.p37c = undefined; a.p37d = v; return a; },
  (v, w) => { const a = [v]; a.p38a = w; a.p38b = undefined; a.p38c = v; a.p38d = w; a.p38e = true; return a; },
  (v, w) => { const a = [v]; a.p39a = undefined; a.p39b = v; a.p39c = w; a.p39d = true; a.p39e = null; a.p39f = "text"; return a; },
];
for (let round = 0; round < 4; round++) {
  let sum = 0;
  let keyText = 0;
  for (let i = 0; i < taggers.length * 60; i++) {
    const element = i % 3 === 0 ? i : i % 3 === 1 ? i + 0.5 : "s" + i;
    const array = taggers[i % taggers.length](element, i);
    const keys = Object.keys(array);
    sum += keys.length + array.length;
    for (const key of keys) {
      keyText += key.length;
      if (array[key] === i) sum += 1;
    }
    if (array[0] !== element) sum = NaN;
  }
  console.log("40 sets of names, round", round, sum, keyText);
  collect();
}
for (let i = 0; i < taggers.length; i += 7) show("set " + i, taggers[i](i, -i));

attempt("length among the names", i => {
  const array = [i + 0.5, i + 1.5, i + 2.5];
  array.index = i;
  array.length = 1;
  array.input = "x";
  array.groups = 2;
  return array;
});
attempt("an index among the names", i => {
  const array = [{ i }, {}];
  array.index = i;
  array["0"] = "zero";
  array["5"] = "five";
  array.input = "x";
  return array;
});
attempt("names on the prototype chain", i => {
  const array = ["a" + i];
  array.index = i;
  array.push = "own";
  array.toString = "own too";
  array.input = "x";
  return array;
});
attempt("a name the array already has", i => {
  const array = [i, i + 1];
  array.input = "first";
  collect();
  array.index = i;
  array.input = "second";
  array.groups = 3;
  return array;
});
attempt("one other name first", i => {
  const array = [i, i + 1];
  array.first = 1;
  collect();
  array.index = i;
  array.input = "x";
  array.groups = 3;
  return array;
});
attempt("two other names first", i => {
  const array = [i, i + 1];
  array.first = 1;
  array.second = 2;
  collect();
  array.index = i;
  array.input = "x";
  array.groups = 3;
  return array;
});
attempt("a constant literal", i => {
  const array = [1, 2, 3];
  array.index = i;
  array.input = "x";
  array.groups = 3;
  array[0] = 9;
  return array;
});
attempt("a sparse array", i => {
  const array = [];
  array[100000] = i;
  array.index = i;
  array.input = "x";
  array.groups = 3;
  array.length = 2;
  return array;
});

const frozen = Object.freeze([1, 2]);
attempt("a frozen array", () => {
  frozen.index = 1;
  frozen.input = "x";
  frozen.groups = 3;
  return frozen;
});
show("unchanged", frozen);
const sealed = Object.seal([1, 2]);
attempt("a sealed array", () => {
  sealed.index = 1;
  sealed.input = "x";
  sealed.groups = 3;
  return sealed;
});
show("unchanged", sealed);
const closed = Object.preventExtensions([1, 2]);
attempt("an array that is not extensible", () => {
  closed.index = 1;
  closed.input = "x";
  closed.groups = 3;
  return closed;
});
show("unchanged", closed);

class List extends Array {}
let setterCalls = 0;
class Watched extends Array {
  set input(value) {
    setterCalls += value.length;
  }
}
class Fixed extends Array {}
Object.defineProperty(Fixed.prototype, "groups", { value: "inherited", writable: false });
function markSubclassInstance(array, i) {
  array.index = i;
  array.input = "xy";
  array.groups = i;
  return array;
}
for (let i = 0; i < 300; i++) markSubclassInstance(List.of(i), i);
attempt("a subclass instance", i => markSubclassInstance(List.of(i, 2), 7));
console.log("still a List:", markSubclassInstance(new List(), 1) instanceof List);
for (let i = 0; i < 300; i++) markSubclassInstance(new Watched(), i);
attempt("a subclass with a setter", i => markSubclassInstance(Watched.of(i), 7));
console.log("setter calls:", setterCalls);
attempt("a subclass with a read-only property", i => markSubclassInstance(Fixed.of(i), 7));

const log = [];
const otherPrototype = Object.create(Array.prototype, { index: { set: value => void log.push(value) } });
attempt("another prototype", i => {
  const array = Object.setPrototypeOf([i], otherPrototype);
  array.index = i;
  array.input = "x";
  array.groups = 3;
  return array;
});
console.log("the setter received:", log.join());
attempt("no prototype", i => {
  const array = Object.setPrototypeOf([i], null);
  array.index = i;
  array.input = "x";
  array.groups = 3;
  return Object.setPrototypeOf(array, Array.prototype);
});
