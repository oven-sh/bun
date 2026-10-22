function store(target, i) {
  target.a = i;
  target.b = i + 1;
  target.c = i + 2;
  target.d = i + 3;
  return target;
}

function attempt(label, target, i) {
  try {
    store(target, i);
  } catch (error) {
    console.log(label, error.name);
  }
  console.log(label, JSON.stringify(target), Object.keys(target).join());
}

let sum = 0;
for (let round = 0; round < 100; round++) sum += store({}, round).d;
console.log("fresh", sum, JSON.stringify(store({}, 1)));

const existing = { a: 0, b: 0, c: 0, d: 0 };
for (let round = 0; round < 3; round++) attempt("all exist", existing, round);

attempt("two exist", { b: 0, a: 0 }, 1);
attempt("out of order", { d: 0, c: 0, b: 0, a: 0 }, 2);
attempt("gap", { a: 0, other: 0, b: 0, c: 0, d: 0 }, 3);

attempt("frozen", Object.freeze({ a: 0, b: 0, c: 0, d: 0 }), 4);
attempt("frozen empty", Object.freeze({}), 5);
attempt("sealed", Object.seal({ a: 0, b: 0, c: 0, d: 0 }), 6);
attempt("sealed partial", Object.seal({ a: 0 }), 7);
attempt("non-extensible", Object.preventExtensions({ a: 0, b: 0, c: 0, d: 0 }), 8);
attempt("non-extensible partial", Object.preventExtensions({ c: 0 }), 9);

const log = [];
const proto = { inherited: true };
const instances = [];
for (let round = 0; round < 4; round++) {
  if (round === 2) {
    Object.defineProperty(proto, "c", {
      configurable: true,
      set(value) {
        log.push(value);
      },
    });
  }
  const instance = store(Object.create(proto), round * 10);
  instances.push(instance);
  console.log("setter round", round, JSON.stringify(instance), Object.keys(instance).join(), JSON.stringify(log));
}
console.log("setter log", log.join());

const parent = {};
const child = Object.create(parent);
console.log("before parent", child.a);
store(parent, 20);
console.log("prototype", JSON.stringify(parent), child.a, child.d, Object.keys(child).length);

const dictionary = { x: 1, y: 2, z: 3 };
delete dictionary.x;
attempt("dictionary", dictionary, 30);
attempt("dictionary again", dictionary, 40);

const wide = {};
for (let i = 0; i < 20; i++) wide["k" + i] = i;
attempt("grows", wide, 50);
