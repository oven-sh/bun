const lines = [];
const say = (title, value) => lines.push(title + ": " + JSON.stringify(value));

function mapCopy() {
  const map = new Map();
  map.set("a", 1);
  const first = new Map(map);
  map.set("a", 2);
  const second = new Map(map);
  return [first.get("a"), second.get("a")];
}
say("new Map(map)", mapCopy());

function mapCopyInLoop() {
  const map = new Map();
  const seen = [];
  for (let i = 0; i < 3; i++) {
    map.set("a", i);
    seen.push(new Map(map).get("a"));
  }
  return seen;
}
say("new Map(map) in a loop", mapCopyInLoop());

function fromEntriesOfMap() {
  const map = new Map();
  map.set("a", 1);
  const first = Object.fromEntries(map);
  map.set("a", 2);
  return [first.a, Object.fromEntries(map).a];
}
say("Object.fromEntries(map)", fromEntriesOfMap());

function typedArrayOfList() {
  const list = [1, 2, 3];
  const first = new Uint8Array(list);
  list[0] = 99;
  const second = new Uint8Array(list);
  const third = new Float64Array(list);
  list[0] = 7;
  return [first[0], second[0], third[0], new Float64Array(list)[0]];
}
say("new Uint8Array(list)", typedArrayOfList());

function typedArrayOfListInLoop() {
  const list = [1, 2, 3];
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    sum += new Int32Array(list)[0];
    list[0] = i * 10;
  }
  return sum;
}
say("new Int32Array(list) in a loop", typedArrayOfListInLoop());

function setOfBytes() {
  const bytes = new Uint8Array([1, 2, 3]);
  const first = new Set(bytes);
  bytes[0] = 99;
  return [first.has(1), first.has(99), new Set(bytes).has(99)];
}
say("new Set(bytes)", setOfBytes());

function textOfList() {
  const list = [1, 2, 3];
  const first = JSON.stringify(list);
  list[0] = 99;
  return [first, JSON.stringify(list)];
}
say("JSON.stringify(list)", textOfList());

function textOfListInLoop() {
  const list = [1, 2, 3];
  let text = "";
  for (let i = 0; i < 3; i++) {
    text += JSON.stringify(list);
    list[1] = i;
  }
  return text;
}
say("JSON.stringify(list) in a loop", textOfListInLoop());

function textOfRecord() {
  const record = { a: 1, inner: { b: 2 } };
  const first = JSON.stringify(record);
  record.inner.b = 3;
  const second = JSON.stringify(record);
  record.a = 4;
  return [first, second, JSON.stringify(record)];
}
say("JSON.stringify(record)", textOfRecord());

function textOfBytes() {
  const bytes = new Uint8Array([1, 2, 3]);
  const first = JSON.stringify(bytes);
  bytes[0] = 99;
  return [first, JSON.stringify(bytes)];
}
say("JSON.stringify(bytes)", textOfBytes());

function ownValuesOfBytes() {
  const bytes = new Uint8Array([1, 2, 3]);
  const before = [Object.values(bytes)[0], Object.entries(bytes)[0][1], Object.getOwnPropertyDescriptors(bytes)[0].value, Array.from(bytes)[0]];
  bytes[0] = 99;
  return [before, Object.values(bytes)[0], Object.entries(bytes)[0][1], Object.getOwnPropertyDescriptors(bytes)[0].value, Array.from(bytes)[0]];
}
say("own values of bytes", ownValuesOfBytes());

function arrayMethodsOnBytes() {
  const bytes = new Uint8Array([1, 2, 3]);
  const all = () => [
    Array.prototype.join.call(bytes, "a"),
    Array.prototype.toString.call(bytes),
    Array.prototype.flat.call(bytes)[0],
    Array.prototype.toReversed.call(bytes)[2],
    Array.prototype.with.call(bytes, 1, 5)[0],
    Array.prototype.toSpliced.call(bytes, 1, 1)[0],
    Object.prototype.toLocaleString.call(bytes),
  ];
  const first = all();
  bytes[0] = 99;
  return [first, all()];
}
say("methods of arrays on bytes", arrayMethodsOnBytes());

function joinTwice() {
  const bytes = new Uint8Array([1, 2, 3]);
  const first = Array.prototype.join.call(bytes, "a");
  bytes[0] = 99;
  return [first, Array.prototype.join.call(bytes, "a")];
}
say("join on bytes", joinTwice());

function sumOfBytes() {
  const bytes = new Uint8Array([1, 2, 3]);
  const first = Math.sumPrecise(bytes);
  bytes[0] = 99;
  return [first, Math.sumPrecise(bytes)];
}
say("Math.sumPrecise(bytes)", sumOfBytes());

function replacementList() {
  const list = [1, 2, 3];
  const first = "a".replace(/a/g, list);
  list[0] = 99;
  return [first, "a".replace(/a/g, list), "a".replaceAll(/a/g, list)];
}
say("a list as the replacement", replacementList());

function dateText() {
  const date = new Date(86400000);
  const first = date.toJSON();
  date.setTime(1000000000000);
  return [first, date.toJSON()];
}
say("date.toJSON()", dateText());

console.log(lines.join("\n"));
