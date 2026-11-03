// Six classes have a method of one name. Each method ends in a tail call of that method on any of the objects, so its result is boxed.
// The call at the bottom goes through the method table, which has one place for the result of every entry and of its lookup.
const all = [];
class A { visit(key) { return key < 1 ? 1 : all[key % all.length].visit(key - 1); } }
class B { visit(key) { return key < 1 ? 2 : all[key % all.length].visit(key - 1); } }
class C { visit(key) { return key < 1 ? 3 : all[key % all.length].visit(key - 1); } }
class D { visit(key) { return key < 1 ? 4 : all[key % all.length].visit(key - 1); } }
class E { visit(key) { return key < 1 ? 5 : all[key % all.length].visit(key - 1); } }
class F { visit(key) { return key < 1 ? 6 : all[key % all.length].visit(key - 1); } }
all.push(new A(), new B(), new C(), new D(), new E(), new F());

let sum = 0;
for (let key = 0; key < 40; key++) sum += all[key % all.length].visit(key) * (key + 1);
console.log(sum, all[0].visit(3), all[5].visit(0), all[2].visit(100000));
