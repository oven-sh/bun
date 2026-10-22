// Arrays filled from the last index down or in shuffled order start out sparse and end up dense; arrays that stay sparse, hold an accessor at an index or have a read-only length behave as in plain Bun.
const collect = globalThis.Bun ? full => globalThis.Bun.gc(full) : full => (full ? fullGC() : edenGC());

function hashText(hash, text) {
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return hash;
}

function textOf(element) {
  return typeof element === "object" ? JSON.stringify(element) : String(element);
}

function describe(array) {
  let holes = 0;
  for (let i = 0; i < array.length; i++) if (!(i in array)) holes++;
  const json = JSON.stringify(array);
  let visited = 0;
  let iterated = 0;
  for (const element of array) {
    visited++;
    iterated = hashText(iterated, textOf(element));
  }
  return `length ${array.length}, holes ${holes}, keys ${Object.keys(array).length}, JSON ${json.length} ${hashText(0, json)}, for-of ${visited} ${iterated}`;
}

function attempt(action) {
  try {
    return String(action());
  } catch (error) {
    return error.constructor.name + ": " + error.message;
  }
}

function store(array, index, value) {
  "use strict";
  array[index] = value;
}

function fillDescending(array, first, last, createElement) {
  for (let i = first; i >= last; i--) array[i] = createElement(i);
}

function descendingOrder(count) {
  const order = [];
  for (let i = count - 1; i >= 0; i--) order.push(i);
  return order;
}

function shuffledOrder(count) {
  const order = descendingOrder(count);
  let state = count;
  for (let i = count - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = (state >>> 8) % (i + 1);
    const swapped = order[i];
    order[i] = order[j];
    order[j] = swapped;
  }
  return order;
}

const elementKinds = {
  integers: i => i,
  doubles: i => i + 0.5,
  strings: i => "s" + i,
  objects: i => ({ id: i }),
  mixed: i => [i, i + 0.25, "m" + i, { id: i }, null, undefined][i % 6],
};

function fill(label, order, createElement) {
  const count = order.length;
  const denseEnough = count >> 3;
  const checkpoints = new Set([denseEnough - 1, denseEnough + 1, count]);
  if (count < 100000) checkpoints.add(1).add(denseEnough).add(count >> 1);
  const array = [];
  let stored = 0;
  for (const index of order) {
    array[index] = createElement(index);
    if (checkpoints.has(++stored)) console.log(`${label} after ${stored}: ${describe(array)}`);
  }
  let mismatches = 0;
  for (let i = 0; i < count; i++) if (textOf(array[i]) !== textOf(createElement(i))) mismatches++;
  array.push(createElement(count));
  array.push(-1, 2.5, "pushed", { pushed: true });
  console.log(`${label} pushed: mismatches ${mismatches}, ${describe(array)}, popped ${textOf(array.pop())} ${textOf(array.pop())}, length ${array.length}`);
  return array;
}

function checkEveryKind() {
  for (const count of [600, 1500, 9000]) {
    for (const [kind, createElement] of Object.entries(elementKinds)) {
      fill(`${kind} ${count} descending`, descendingOrder(count), createElement);
      fill(`${kind} ${count} shuffled`, shuffledOrder(count), createElement);
    }
  }
  for (const kind of ["integers", "mixed"]) {
    fill(`${kind} 120000 descending`, descendingOrder(120000), elementKinds[kind]);
    fill(`${kind} 120000 shuffled`, shuffledOrder(120000), elementKinds[kind]);
  }
}

function checkSparseAgainAfterDense() {
  const array = fill("dense twice", descendingOrder(2000), elementKinds.strings);
  const start = array.length;
  fillDescending(array, start + 7999, start, elementKinds.doubles);
  console.log(`dense twice, second fill: ${describe(array)}, push ${array.push("pushed")}`);
}

function checkHolesRemain() {
  const array = [];
  for (let i = 4998; i >= 0; i -= 2) array[i] = { id: i };
  console.log(`every other index: ${describe(array)}, ${textOf(array[4997])} ${textOf(array[4998])}, push ${array.push("pushed")}`);
  for (let i = 4997; i >= 0; i -= 2) array[i] = i;
  console.log(`every index: ${describe(array)}`);
}

function checkDeleteAndShortenWhileSparse() {
  const array = [];
  fillDescending(array, 3999, 3600, elementKinds.strings);
  for (let i = 3999; i >= 3600; i -= 3) delete array[i];
  console.log(`deleted while sparse: ${describe(array)}`);
  array.length = 3700;
  console.log(`shortened while sparse: ${describe(array)}`);
  fillDescending(array, 3650, 0, elementKinds.integers);
  console.log(`filled afterwards: ${describe(array)}, push ${array.push("pushed")}`);
}

function checkYoungElementsInOldArray() {
  const array = [];
  array[3999] = { id: 3999 };
  collect(true);
  fillDescending(array, 3998, 0, elementKinds.objects);
  collect(false);
  const garbage = [];
  for (let i = 0; i < 20000; i++) garbage[i % 64] = { id: -i, text: "garbage " + i };
  collect(false);
  let total = 0;
  for (const element of array) total += element.id;
  console.log(`young elements in an old array: ${describe(array)}, total ${total}, garbage ${garbage.length}`);
}

function checkStaysSparse() {
  const array = [];
  array[200000] = "last";
  for (let i = 0; i < 2000; i++) array[i * 97] = i;
  console.log(`stays sparse: ${describe(array)}`);
  console.log(`stays sparse: push ${array.push("pushed")}, ${textOf(array[200000])} ${textOf(array[200001])} ${textOf(array[199999])}, ${describe(array)}`);
}

function checkMaximumIndex() {
  const array = [];
  array[4294967294] = "last";
  fillDescending(array, 99, 0, elementKinds.integers);
  console.log(`maximum index: length ${array.length}, keys ${Object.keys(array).length}, ${textOf(array[4294967294])}`);
  console.log(`maximum index: push ${attempt(() => array.push("pushed"))}, length ${array.length}, keys ${Object.keys(array).length}`);
}

function checkGetterAtIndex() {
  const array = [];
  let reads = 0;
  Object.defineProperty(array, 2999, { get: () => "read " + ++reads, enumerable: true, configurable: true });
  fillDescending(array, 2998, 0, elementKinds.integers);
  console.log(`getter: ${describe(array)}, reads ${reads}`);
  console.log(`getter: store ${attempt(() => store(array, 2999, "stored"))}, push ${array.push("pushed")}, ${textOf(array[2999])}, reads ${reads}`);
  Object.defineProperty(array, 2999, { value: "data", writable: true, enumerable: true, configurable: true });
  console.log(`getter redefined as data: ${describe(array)}, reads ${reads}`);
}

function checkSetterAtIndex() {
  const array = [];
  const received = [];
  Object.defineProperty(array, 10, { get: () => received.length, set: value => received.push(value), enumerable: true, configurable: true });
  fillDescending(array, 2999, 0, elementKinds.integers);
  console.log(`setter: ${describe(array)}, received ${received.join()}, push ${array.push("pushed")}`);
}

function checkReadOnlyLength() {
  const array = [];
  array[2999] = "last";
  Object.defineProperty(array, "length", { writable: false });
  fillDescending(array, 2998, 0, elementKinds.integers);
  console.log(`read-only length: ${describe(array)}`);
  console.log(`read-only length: push ${attempt(() => array.push("pushed"))}, store ${attempt(() => store(array, 3000, "stored"))}, length ${array.length}, ${3000 in array}`);
}

function checkNonExtensible() {
  const array = [];
  array[2999] = "last";
  array[5] = "five";
  Object.preventExtensions(array);
  let failures = 0;
  for (let i = 2998; i >= 0; i--) {
    try {
      store(array, i, i);
    } catch {
      failures++;
    }
  }
  console.log(`non-extensible: ${describe(array)}, failures ${failures}, ${textOf(array[5])}, push ${attempt(() => array.push("pushed"))}`);
}

function checkNamedProperty() {
  const array = [];
  array.label = "named";
  fillDescending(array, 2999, 0, elementKinds.strings);
  console.log(`named property: ${describe(array)}, ${array.label}, push ${array.push("pushed")}`);
}

function checkSubclass() {
  class List extends Array {}
  const list = new List();
  fillDescending(list, 2999, 0, elementKinds.doubles);
  console.log(`subclass: ${describe(list)}, push ${list.push("pushed")}, ${list instanceof List} ${list.slice(0, 2) instanceof List}`);
}

checkEveryKind();
checkSparseAgainAfterDense();
checkHolesRemain();
checkDeleteAndShortenWhileSparse();
checkYoungElementsInOldArray();
checkStaysSparse();
checkMaximumIndex();
checkGetterAtIndex();
checkSetterAtIndex();
checkReadOnlyLength();
checkNonExtensible();
checkNamedProperty();
checkSubclass();
