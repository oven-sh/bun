const names = holder => Reflect.ownKeys(holder).map(String).join();

JSON.stringify(1);
[JSON].map(each => Object.entries(each));
console.log("JSON", names(JSON));

Reflect.has({}, "a");
const kept = new Map([[1, Reflect]]);
({ ...kept.get(1) });
console.log("Reflect", names(Reflect));

Array.of(1);
const list = Object.getPrototypeOf(JSON.parse("[]")).constructor;
({ ...list });
console.log("Array", names(list));

String.fromCharCode(65);
Object.entries.bind(null, String)();
console.log("String", names(String));

BigInt.asIntN(8, 1n);
Reflect.apply(Object.assign, null, [{}, BigInt]);
console.log("BigInt", names(BigInt));

Object.is(1, 1);
const { is, ...rest } = new WeakRef(Object).deref();
console.log("Object", names(Object));

Symbol.for("a");
function* symbols() {
  yield Symbol;
}
for (const each of symbols()) {
  Object.entries(each);
  console.log("Symbol", names(each));
}

Buffer.alloc(1);
const bytes = Buffer.alloc(4).slice(1, 3).constructor;
Object.assign({}, bytes);
console.log("Buffer", names(bytes));

Atomics.isLockFree(4);
for (const each of new Set([Atomics])) {
  ({ ...each });
  console.log("Atomics", names(each));
}

Number.isNaN(1);
Promise.resolve(Number).then(each => {
  Object.assign({}, each);
  console.log("Number", names(each));
});

Promise.all([]);
const settled = Promise.resolve(1);
settled.then(() => {
  ({ ...settled.constructor });
  console.log("Promise", names(settled.constructor));
});

Math.hypot(1);
process.nextTick(each => {
  Object.values(each);
  console.log("Math", names(each));
}, Math);

Intl.getCanonicalLocales("en");
queueMicrotask(function () {
  const each = this ?? Intl;
  Object.entries(each);
  console.log("Intl", names(each));
});

Date.now();
setTimeout(
  each => {
    ({ ...each });
    console.log("Date", names(each));
  },
  0,
  Date,
);
