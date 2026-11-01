// A statement that ends in a member of a built-in object evaluates what stands in front of the member.
function said() {
  console.log("called");
}
said(), Object.keys;
(said(), Object.keys);
said(), Math.PI;
(said(), Object).keys;
(said(), Object)["keys"];
(said(), globalThis).Object.keys;
(said(), Object)?.keys;
void (said(), Object.keys);
!(said(), Object.keys);
typeof (said(), Object.keys);
typeof (said(), Object).keys;
console.log(delete (said(), Object.keys));
console.log(void (said(), Object.keys));
true ? (said(), Object.keys) : Object.keys;
Object.keys && (said(), Object.keys);
if (Object.keys && (said(), Object.keys)) console.log("yes");
console.log((true ? (said(), Object.keys) : Object.keys) ? "yes" : "no");

for (let turn = 0; turn < 2; turn++, Math.PI) console.log("turn", turn);
for (let turn = 0; turn < 2; turn++, Object.keys) console.log("turn", turn);
let count = 0;
for (count++, Object.keys; count < 3; (count++, Object).keys) console.log("count", count);
while ((count--, Object.keys) && count > 0) console.log("count", count);

function ending(f) {
  try {
    f();
    console.log("completes");
  } catch (error) {
    console.log("throws", error.constructor.name);
  }
}
const object = {};
function Derived() {}
ending(() => {
  object.shout(), Object.keys;
});
ending(() => {
  Derived.shout(), Object.keys;
});
ending(() => {
  object.shout(), Math.PI;
});
ending(() => {
  (object.shout(), Object).keys;
});
ending(() => {
  neverDeclared, Object.keys;
});
ending(() => {
  void (object.shout(), Symbol.iterator);
});

let variable = 0;
variable = 1, Object.keys;
console.log(variable);
variable++, Array.prototype.slice;
console.log(variable);
const holder = {
  get read() {
    console.log("read");
    return 1;
  },
};
holder.read, JSON.stringify;
(holder.read, JSON).stringify;
await { then(resolve) { console.log("then"); resolve(); } }, Reflect.ownKeys;
function* generator() {
  yield 1, Object.keys;
  (yield 2, Object).keys;
}
console.log([...generator()].join());
console.log("end");
