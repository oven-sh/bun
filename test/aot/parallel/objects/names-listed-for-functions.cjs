// Functions that go through a list and store under its names, by themselves or through a callback that they are passed.
"use strict";
const lines = [];
const say = (...all) => lines.push(all.join(" "));
function attempt(f) {
  try {
    const value = f();
    return typeof value === "function" ? "function" : String(value);
  } catch (error) {
    return error.constructor.name;
  }
}
function each(list, f) {
  for (let i = 0; i < list.length; i++) f(list[i], i);
}
function eachUntil(list, f) {
  let i = -1;
  const n = list.length;
  while (++i < n) {
    if (f(list[i], i) === false) break;
  }
}
function eachBeyond(list, f) {
  for (let i = 0; i <= list.length; i++) f(list[i], i);
}
function eachUnchecked(list, f) {
  for (let i = 0; i < 3; i++) f(list[i], i);
}
function eachChanged(list, f) {
  list[0] = "changed";
  for (let i = 0; i < list.length; i++) f(list[i], i);
}
const keptLists = [];
function eachKept(list, f) {
  keptLists.push(list);
  for (let i = 0; i < list.length; i++) {
    f(list[i], i);
    if (i === 0) keptLists[0][1] = "keptChanged";
  }
}
function eachRow(list, f) {
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    if (row[1] > 1) row[0] = "altered";
    f(row);
  }
}
function eachOther(list, f) {
  f("other", -1);
  for (let i = 0; i < list.length; i++) f(list[i], i);
}
function eachArguments(list, f) {
  arguments[0][0] = "viaArguments";
  for (let i = 0; i < list.length; i++) f(list[i], i);
}
function mixin(target, names) {
  for (const name of names) {
    target[name] = function (x) {
      return this.v + x + name.length;
    };
  }
}
function mixinAgain(target, names, more) {
  for (const name of names) target[name] = x => name + x;
  if (more) others[0](target, ["viaOther"]);
}
const others = [mixinAgain];
function mixinChanged(target, names) {
  names.push("pushed");
  for (const name of names) target[name] = () => name;
}
class A {
  constructor(v) {
    this.v = v;
  }
}
class B extends A {}
class C {
  constructor(v) {
    this.v = v;
  }
}
class D {
  constructor(v) {
    this.v = v;
  }
}
function Wrapper(v) {
  this.v = v;
}
each(["add", "sub"], function (name, i) {
  Wrapper.prototype[name] = function (x) {
    return i ? this.v - x : this.v + x;
  };
});
eachUntil(["mul", "div", "never"], function (name, i) {
  if (name === "never") return false;
  Wrapper.prototype[name] = function (x) {
    return i ? this.v / x : this.v * x;
  };
});
eachBeyond(["beyond"], name => { C.prototype[name] = () => "b" + name; });
eachUnchecked(["unchecked", "two"], name => { C.prototype[name] = () => "u" + name; });
eachChanged(["first", "second"], name => { C.prototype[name] = () => "c" + name; });
eachKept(["third", "fourth"], name => { C.prototype[name] = () => "k" + name; });
eachRow([["fifth", 1], ["sixth", 2]], row => { C.prototype[row[0]] = () => "r" + row[1]; });
eachOther(["seventh"], name => { C.prototype[name] = () => "o" + name; });
eachArguments(["eighth", "ninth"], name => { C.prototype[name] = () => "a" + name; });
mixin(A.prototype, ["foo", "bar"]);
mixin(C.prototype, ["baz"]);
mixinAgain(D.prototype, ["one", "two"], true);
mixinChanged(B.prototype, ["late"]);
const w = new Wrapper(12), a = new A(3), b = new B(4), c = new C(5), d = new D(6);
function run(turns) {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    sum += w.add(turn & 3) + w.sub(1) + w.mul(2) + w.div(2);
    sum += a.foo(turn & 7) + a.bar(1) + b.foo(2) + c.baz(3);
  }
  return sum;
}
for (let round = 0; round < 3; round++) say(run(50));
const names = ["beyond", "undefined", "unchecked", "two", "changed", "first", "second", "third", "fourth", "keptChanged", "fifth", "sixth", "altered", "other", "seventh", "eighth", "viaArguments", "ninth", "foo", "bar", "baz", "one", "viaOther", "pushed", "late", "never", "add"];
for (const one of [w, a, b, c, d]) {
  say(one.constructor.name, names.map(name => attempt(() => one[name]?.(1))).join());
  say(names.filter(name => name in one).join(), Object.keys(Object.getPrototypeOf(one)).join());
}
say(attempt(() => c.undefined), attempt(() => c.changed()), attempt(() => c.altered()), attempt(() => c.viaArguments()), attempt(() => d.viaOther(2)), attempt(() => b.pushed()));
console.log(lines.join("\n"));
