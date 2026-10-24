// A name that the program's own code adds to a built-in prototype is stored, whichever way the object and the name come to the store.
function pick(list, index) { return list[index % list.length]; }
const prototypeOf = Object.getPrototypeOf;
const allIterators = prototypeOf(prototypeOf([][Symbol.iterator]()));
const holders = [allIterators, Array.prototype, Error.prototype, Map.prototype, JSON.parse('{"own":1}')];
function store(object, key, value) { object[key] = value; return object[key]; }
function storeByName(object, value) { object.addedByName = value; return object.addedByName; }

console.log("before", [][Symbol.iterator]().addedByName, [].addedByName, new Error("x").addedByName, new Map().addedByName);
for (let index = 0; index < holders.length; index++) {
  try { console.log("by name", index, storeByName(pick(holders, index), index + 1)); } catch (error) { console.log("by name", index, error.name); }
}
console.log("after", [][Symbol.iterator]().addedByName, [].addedByName, new Error("x").addedByName, new Map().addedByName, typeof new Map()[Symbol.iterator]().addedByName);

console.log("before", [][Symbol.iterator]().addedAsText, [].addedAsText, new Error("x").addedAsText);
for (let index = 0; index < holders.length; index++) {
  try { console.log("as a text", index, store(pick(holders, index), "addedAsText", "text" + index)); } catch (error) { console.log("as a text", index, error.name); }
}
console.log("after", [][Symbol.iterator]().addedAsText, [].addedAsText, new Error("x").addedAsText, new Set()[Symbol.iterator]().addedAsText.length);

function length(value) { return value === undefined ? -1 : value.length; }
console.log(length([].values().addedAsText), length([].addedAsText), length(new Error("y").addedAsText), length({}.addedAsText));
for (const holder of holders) { delete holder.addedByName; delete holder.addedAsText; }
console.log("deleted", [][Symbol.iterator]().addedByName, [].addedAsText);
