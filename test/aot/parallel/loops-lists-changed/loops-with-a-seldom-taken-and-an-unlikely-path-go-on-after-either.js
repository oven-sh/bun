// A loop reads a list and a box. Two paths change what it reads: a push that finds room or has to grow the list, which is seldom taken, and a call behind a test of the counter,
// which is only guessed to be unlikely. The turns behind either must see the change, in whichever order and however close together the two are taken.
const out = [];
function change(box, i) {
  box.weight = (box.weight + i) | 0;
  box.names = i & 1 ? [...box.names, "n" + i] : ["only"];
}
function sumOfListAndBox(list, n, box, at, every) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (i === at || i % every === every - 1) change(box, i);
    const value = list[i & 15];
    sum = (sum * 3 + box.weight + box.names.length + (value === undefined ? list.push(i & 7) : value)) % 1000003;
  }
  return sum + list.length * 7 + box.names.length;
}
function pushesIntoTheBox(list, n, box) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const value = list[i & 15];
    sum = (sum * 3 + box.weight + box.names.length + (value === undefined ? box.names.push("x") + list.push(1) : value)) % 1000003;
  }
  return sum + list.length * 7 + box.names.length;
}
function replacesTheList(box, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const value = box.list[i & 7];
    if (value === undefined) {
      if (box.list.length === 6) box.list = [9, 8, 7, 6, 5, 4, 3];
      else box.list.push(i & 3);
    }
    sum = (sum * 3 + box.weight + box.list.length + (value === undefined ? 1 : value)) % 1000003;
  }
  return sum + box.list.length;
}
const listOf = length => {
  const list = [];
  for (let i = 0; i < length; i++) list.push(i + 1);
  return list;
};
for (const length of [0, 1, 3, 7, 8, 12, 15, 16]) {
  for (const n of [0, 1, 2, 3, 9, 17, 64, 1000]) {
    const row = [];
    for (const at of [-1, 0, 1, 2, 7, 8, 9, 20, 999]) {
      for (const every of [1000000, 100, 16, 3, 1]) row.push(sumOfListAndBox(listOf(length), n, { weight: 1, names: ["a"] }, at, every));
    }
    row.push(pushesIntoTheBox(listOf(length), n, { weight: 2, names: ["a", "b"] }), replacesTheList({ weight: 3, list: listOf(length & 7) }, n));
    let mixed = 0;
    for (const value of row) mixed = (mixed * 31 + value) % 1000003;
    out.push(`${length} ${n}: ${mixed} ${row[0]} ${row[row.length - 2]} ${row[row.length - 1]}`);
  }
}
console.log(out.join("\n"));
