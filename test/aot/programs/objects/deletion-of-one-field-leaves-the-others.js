// A deletion that names its key takes that field alone out of the object. The fields beside it stay where they are: reads, `in`, the order of the keys, a store that brings the field back,
// and a deletion under a computed key, which may take any of them.
function make(i) {
  return { cache: i, kept: i * 2, label: "n" + i };
}

const entry = make(1);
console.log(entry.kept, entry.cache, entry.label);
delete entry.cache;
console.log(entry.kept, entry.cache, entry.label, "cache" in entry, "kept" in entry, Object.keys(entry).join());
entry.cache = 7;
console.log(entry.kept, entry.cache, Object.keys(entry).join(), JSON.stringify(entry));

let sum = 0;
for (let i = 0; i < 10; i++) {
  const each = make(i);
  if (i & 1) delete each.cache;
  sum += each.kept + (each.cache ?? 100) + each.label.length;
}
console.log(sum);

class Node {
  constructor(value) {
    this.value = value;
    this.memo = value + 1;
    this.next = null;
  }
  forget() {
    delete this.memo;
    return this;
  }
}
const first = new Node(1), second = new Node(2).forget();
first.next = second;
console.log(first.memo, second.memo, first.next.value, second.next, Object.keys(second).join(), second.hasOwnProperty("memo"));

const names = ["kept", "label"];
const other = make(3);
delete other[names[process.argv.length > 99 ? 0 : 1]];
console.log(other.kept, other.label, other.cache, Object.keys(other).join());
