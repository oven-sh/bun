// The classes of a family are changed while the program runs: a method is replaced, an object hides it, and one holds what cannot be called.
// A tail call of the name finds what plain Bun finds, needs no stack, and an error lists the frames that plain Bun lists.
const all = [];
class A { step(key) { return key < 1 ? "A" : all[key % all.length].step(key - 1); } }
class B { step(key) { return key < 1 ? "B" : all[key % all.length].step(key - 1); } }
class C { step(key) { return key < 1 ? "C" : all[key % all.length].step(key - 1); } }
class D { step(key) { return key < 1 ? "D" : all[key % all.length].step(key - 1); } }
class E { step(key) { return key < 1 ? "E" : all[key % all.length].step(key - 1); } }
class F { step(key) { return key < 1 ? "F" : all[key % all.length].step(key - 1); } }
all.push(new A(), new B(), new C(), new D(), new E(), new F());
function frames(error) {
  return error.stack.split("\n").slice(1, 3).map(line => line.trim().replace(/[^ (]*[\\/]/, "")).join(" | ");
}
function run(name, first, key) {
  try {
    console.log(name, all[first].step(key));
  } catch (error) {
    console.log(name, error.constructor.name, frames(error));
  }
}
run("as defined", 2, 9);
B.prototype.step = function (key) { "use strict"; return key < 1 ? "new B" : all[key % all.length].step(key - 1); };
run("replaced", 2, 7);
run("replaced, deep", 1, 1000001);
all[3].step = function (key) { "use strict"; return key < 1 ? "own D" : all[(key + 1) % all.length].step(key - 1); };
run("hidden", 2, 9);
run("hidden, deep", 3, 1000003);
E.prototype.step = 5;
run("not callable", 2, 10);
run("not callable at once", 4, 3);
delete F.prototype.step;
run("gone", 0, 5);
all.push(undefined);
run("no object", 0, 6);
all[6] = null;
run("null", 0, 13);
