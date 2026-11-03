// The own keys of the arguments object of a strict function: a member added before anybody has listed them, one added afterwards, and what writing, removing, defining, freezing and copying do to the order.
function take() {
  return arguments;
}
const keysOf = object => Reflect.ownKeys(object).map(String).join();

const addedFirst = take(1, 2);
addedFirst.y = "added";
console.log(keysOf(addedFirst));

const listedFirst = take(1, 2);
console.log(keysOf(listedFirst));
listedFirst.y = "added";
console.log(keysOf(listedFirst));

const iteratorWritten = take(1);
iteratorWritten.y = 1;
iteratorWritten[Symbol.iterator] = null;
iteratorWritten.z = 2;
console.log(keysOf(iteratorWritten), iteratorWritten[Symbol.iterator]);

const iteratorRemoved = take(1);
iteratorRemoved.y = 1;
console.log(delete iteratorRemoved[Symbol.iterator], keysOf(iteratorRemoved));

const calleeDefined = take();
calleeDefined.y = 1;
try {
  Object.defineProperty(calleeDefined, "callee", { value: 1 });
} catch (error) {
  console.log(error.constructor.name);
}
console.log(keysOf(calleeDefined));

const frozen = take(1);
frozen.y = 1;
Object.freeze(frozen);
console.log(keysOf(frozen), Object.isFrozen(frozen));

const read = take(1, 2, 3);
read.y = 1;
console.log(
  typeof read[Symbol.iterator],
  [...read].join(),
  "callee" in read,
  Object.hasOwn(read, "callee"),
  Object.hasOwn(read, Symbol.iterator),
);
console.log(keysOf(read));
try {
  read.callee;
} catch (error) {
  console.log(error.constructor.name);
}

const described = take(1);
described.y = 1;
console.log(
  Object.keys(Object.getOwnPropertyDescriptors(described)).join(),
  typeof Object.getOwnPropertyDescriptor(described, "callee").get,
);

const enumerated = take(1, 2);
enumerated.y = 1;
console.log(Object.keys(enumerated).join(), JSON.stringify({ ...enumerated }), keysOf(enumerated));

function sum() {
  let total = 0;
  for (const value of arguments) total += value;
  return (
    total +
    Math.max.apply(null, arguments) +
    Array.prototype.slice.call(arguments, 1).length +
    Array.from(arguments).length
  );
}
let last = 0;
for (let turn = 0; turn < 50; turn++) last = sum(turn, 2, 3);
console.log(last);
