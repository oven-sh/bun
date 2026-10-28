// Old objects, closure environments and arrays get young objects by slot store, by-name store and o[k] = v, and every young object is read back after an Eden collection.
import "../jsc-shell-functions.ts";

const ownerCount = 300;
const listLength = 8;
const storesPerIndex = 7;
const keys = ["first", "second", "third", Symbol("fourth")];
const recordPrototype = { kind: "inherited" };
const recent = new Array(64).fill(null);
let lastBase = 0;

class Link {
  constructor() {
    this.target = null;
  }
}

class Node {
  constructor(id) {
    this.id = id;
    this.child = null;
  }
}

function createChild(id) {
  return { id, label: "child " + id, inner: { id: id + 1 } };
}

function isChild(value, id) {
  return typeof value === "object" && value !== null && value.id === id && value.label === "child " + id && value.inner.id === id + 1;
}

function createPrimitive(id) {
  switch (id % 5) {
    case 0:
      return id;
    case 1:
      return id + 0.25;
    case 2:
      return null;
    case 3:
      return undefined;
    default:
      return id % 2 === 0;
  }
}

function isPrimitive(value, id) {
  return Object.is(value, createPrimitive(id));
}

function isPrimitiveId(id) {
  return (id >>> 3) % 3 === 0;
}

function createMixed(id) {
  return isPrimitiveId(id) ? createPrimitive(id) : createChild(id);
}

function isMixed(value, id) {
  return isPrimitiveId(id) ? isPrimitive(value, id) : isChild(value, id);
}

function createRecord(i) {
  switch (i % 5) {
    case 0:
      return { child: null, a: i };
    case 1:
      return { b: i, c: i + 1, child: null };
    case 2:
      return JSON.parse('{"kind":"parsed","child":null}');
    case 3:
      return Object.create(recordPrototype);
    default: {
      const record = {};
      for (let k = 0; k < 12; k++) record["p" + k] = k;
      return record;
    }
  }
}

function createCell() {
  let value = null;
  return {
    get: () => value,
    set: newValue => {
      value = newValue;
    },
  };
}

function createOwners() {
  const owners = { links: [], nodes: [], records: [], dictionaries: [], lists: [], cells: [] };
  for (let i = 0; i < ownerCount; i++) {
    owners.links.push(new Link());
    owners.nodes.push(new Node(i));
    owners.records.push(createRecord(i));
    owners.dictionaries.push(i % 2 ? { first: null, second: null, third: null } : {});
    owners.lists.push(new Array(listLength).fill(i % 2 ? null : 0));
    owners.cells.push(createCell());
  }
  return owners;
}

function storeByName(object, value) {
  object.child = value;
}

function storeByKey(object, key, value) {
  object[key] = value;
}

function storeAll(owners, createValue, base) {
  for (let i = 0; i < ownerCount; i++) {
    const id = base + i * storesPerIndex;
    owners.links[i].target = createChild(id);
    owners.nodes[i].child = createValue(id + 1);
    storeByName(owners.records[i], createValue(id + 2));
    storeByKey(owners.dictionaries[i], keys[i % keys.length], createValue(id + 3));
    owners.lists[i][i % listLength] = createValue(id + 4);
    storeByKey(owners.lists[i], (i + 1) % listLength, createValue(id + 5));
    owners.cells[i].set(createValue(id + 6));
  }
}

function countMismatches(owners, matches, base) {
  let mismatches = 0;
  for (let i = 0; i < ownerCount; i++) {
    const id = base + i * storesPerIndex;
    if (!isChild(owners.links[i].target, id)) mismatches++;
    if (owners.nodes[i].id !== i || !matches(owners.nodes[i].child, id + 1)) mismatches++;
    if (!matches(owners.records[i].child, id + 2)) mismatches++;
    if (!matches(owners.dictionaries[i][keys[i % keys.length]], id + 3)) mismatches++;
    if (!matches(owners.lists[i][i % listLength], id + 4)) mismatches++;
    if (!matches(owners.lists[i][(i + 1) % listLength], id + 5)) mismatches++;
    if (!matches(owners.cells[i].get(), id + 6)) mismatches++;
  }
  return mismatches;
}

function nextBase() {
  lastBase += 100000;
  return lastBase;
}

function churn() {
  for (let i = 0; i < 30000; i++) recent[i & 63] = createChild(-1 - i);
}

function storeCollectAndCheck(description, owners, createValue, matches) {
  const base = nextBase();
  storeAll(owners, createValue, base);
  edenGC();
  churn();
  console.log(description + ": " + countMismatches(owners, matches, base) + " mismatches");
}

function storeWithoutExplicitCollections(owners) {
  const retained = [];
  const retainedIds = [];
  let mismatches = 0;
  for (let round = 0; round < 40; round++) {
    const base = nextBase();
    storeAll(owners, createChild, base);
    for (let i = 0; i < 2000; i++) {
      retained.push(createChild(base + 50000 + i));
      retainedIds.push(base + 50000 + i);
    }
    mismatches += countMismatches(owners, isChild, base);
  }
  for (let i = 0; i < retained.length; i++) {
    if (!isChild(retained[i], retainedIds[i])) mismatches++;
  }
  console.log("old owners, collections at any time: " + mismatches + " mismatches");
}

const objectOwners = createOwners();
const primitiveOwners = createOwners();
const mixedOwners = createOwners();
gc();
gc();

for (let round = 0; round < 4; round++) {
  storeCollectAndCheck("old owners, young objects, round " + round, objectOwners, createChild, isChild);
  storeCollectAndCheck("old owners, numbers and null, round " + round, primitiveOwners, createPrimitive, isPrimitive);
  storeCollectAndCheck("old owners, young objects or numbers, round " + round, mixedOwners, createMixed, isMixed);
  storeCollectAndCheck("young owners, young objects, round " + round, createOwners(), createChild, isChild);
  if (round % 2) gc();
}

storeWithoutExplicitCollections(objectOwners);
