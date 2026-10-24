// Old arrays of 5,000 and of 1,000 elements get young objects, strings and arrays at scattered indexes, 12,000 between two Eden collections, and every element is read back.
const collect = globalThis.Bun ? full => globalThis.Bun.gc(full) : full => (full ? fullGC() : edenGC());
const storesPerRound = 20000;
const oldObjects = [];
for (let i = 0; i < 8; i++) oldObjects.push({ id: 1000000 + i });
const recent = new Array(64).fill(null);
let churnTotal = 0;

function kindOf(id) {
  return (id >>> 3) % 5;
}

function createElement(id) {
  switch (kindOf(id)) {
    case 0:
      return { id };
    case 1:
      return "text " + id;
    case 2:
      return [id, id + 1];
    case 3:
      return id + 0.5;
    default:
      return oldObjects[id % oldObjects.length];
  }
}

function textOf(element) {
  if (element === null) return "null";
  if (typeof element !== "object") return String(element);
  return Array.isArray(element) ? "array " + element[0] + "," + element[1] : "object " + element.id;
}

function expectedText(id) {
  if (id < 0) return "null";
  switch (kindOf(id)) {
    case 0:
      return "object " + id;
    case 1:
      return "text " + id;
    case 2:
      return "array " + id + "," + (id + 1);
    case 3:
      return String(id + 0.5);
    default:
      return "object " + (1000000 + (id % oldObjects.length));
  }
}

function churn() {
  for (let i = 0; i < 20000; i++) {
    recent[i & 63] = createElement(i);
    churnTotal += textOf(recent[(i * 7) & 63]).length;
  }
}

function countMismatches(array, storedIds) {
  let mismatches = 0;
  for (let index = 0; index < array.length; index++) {
    if (textOf(array[index]) !== expectedText(storedIds[index])) mismatches++;
  }
  return mismatches;
}

function run(length) {
  const array = new Array(length).fill(null);
  const storedIds = new Array(length).fill(-1);
  collect(true);
  collect(true);
  console.log(length + " elements, nothing stored: " + countMismatches(array, storedIds) + " mismatches");
  for (let round = 0; round < 4; round++) {
    for (let step = 0; step < storesPerRound; step++) {
      const id = round * storesPerRound + step;
      const index = (id * 7919) % length;
      array[index] = createElement(id);
      storedIds[index] = id;
    }
    collect(false);
    churn();
    console.log(length + " elements, round " + round + ": " + countMismatches(array, storedIds) + " mismatches");
  }
  collect(true);
  churn();
  console.log(length + " elements, full collection: " + countMismatches(array, storedIds) + " mismatches");
}

run(5000);
run(1000);
console.log("churn: " + churnTotal);
