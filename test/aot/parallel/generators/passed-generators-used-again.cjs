// A function that looks at a generator before it walks it is copied up to the loop. The call that it gives way to gets the generator that its caller goes on with.
function* range(from, to) {
  for (let i = from; i <= to; i++) yield i;
}

function walk(data) {
  if (data[Symbol.asyncIterator] !== undefined) return "async";
  let sum = 0;
  for (const value of data) sum += value;
  return sum;
}

const make = finish => data => {
  if (typeof data.then === "function") return "promise";
  let sum = 0;
  for (const value of data) sum += value;
  return finish(sum);
};
const walkAndAdd = make(sum => sum + 1);

function run(data) {
  walk(data);
  return data.next().done;
}

const once = range(1, 2);
walk(once);
console.log(once.next().done);

const twice = range(1, 3);
console.log(walk(twice), walk(twice));

const added = range(1, 2);
console.log(walkAndAdd(added), added.next().done);

console.log(run(range(1, 2)), walk(range(3, 4)));

const holder = { data: range(5, 6) };
walk(holder.data);
console.log(holder.data.next().done);

for (let i = 0; i < 3; i++) {
  const data = range(i, 3);
  walk(data);
  console.log([...data].length);
}

const prototype = range.prototype;
Object.setPrototypeOf(prototype, {
  __proto__: Object.getPrototypeOf(prototype),
  return() {
    return {};
  },
});
const changed = range(1, 2);
console.log(walk(changed), changed.next().done);
