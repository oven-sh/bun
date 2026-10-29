// A variable of a module is initialized by a built-in that reads the bytes of a typed array, or the lastIndex of a regular expression, through their properties. The bytes and the index change before the variable is first read.
const bytes = new Uint8Array([1, 2]);
const pattern = /a/g;
pattern.lastIndex = 3;
const assigned = Object.assign({}, bytes);
const values = Object.values(bytes);
const entries = Object.entries(bytes);
const spread = { ...bytes };
const listed = [...bytes];
const from = Array.from(bytes);
const text = JSON.stringify(bytes);
const got = Reflect.get(bytes, 0);
const described = Object.getOwnPropertyDescriptor(bytes, "0");
const all = Object.getOwnPropertyDescriptors(bytes);
const sliced = Array.prototype.slice.call(bytes);
const joined = Array.prototype.join.call(bytes);
const concatenated = [0].concat(Object.defineProperty(new Uint8Array([7, 8]), Symbol.isConcatSpreadable, { value: true }));
const index = Reflect.get(pattern, "lastIndex");
const indexDescribed = Object.getOwnPropertyDescriptor(pattern, "lastIndex");
const indexAssigned = Object.getOwnPropertyDescriptors(pattern);
bytes[0] = 9;
bytes[1] = 8;
pattern.lastIndex = 5;
function read() {
  return [assigned[0], values[0], entries[0][1], spread[0], listed[0], from[0], text, got, described.value, all[0].value, sliced[0], joined, concatenated.join(), index, indexDescribed.value, indexAssigned.lastIndex.value].join(" ");
}
console.log(read());
console.log(read());
