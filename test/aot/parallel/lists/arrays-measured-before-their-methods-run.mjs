// STATISTIC: ArrayCallbacksRunByStubs >= 5
// The functions are too large to be copied into the loop.
// The length of a value is read before one of its methods is passed a function: an array is expected.
const one = Number("1");
let seen = 0;
// Nothing is known of what comes back.
const hidden = value => JSON.parse("0", () => value);
function names(list, turn) {
  if (turn < -1) {
    console.log('never 0', turn * 2, turn - 0, 'x' + turn, turn % 3);
    console.log('never 1', turn * 3, turn - 1, 'x' + turn, turn % 4);
    console.log('never 2', turn * 4, turn - 2, 'x' + turn, turn % 5);
    console.log('never 3', turn * 5, turn - 3, 'x' + turn, turn % 6);
    console.log('never 4', turn * 6, turn - 4, 'x' + turn, turn % 7);
    console.log('never 5', turn * 7, turn - 5, 'x' + turn, turn % 8);
    console.log('never 6', turn * 8, turn - 6, 'x' + turn, turn % 9);
    console.log('never 7', turn * 9, turn - 7, 'x' + turn, turn % 10);
    console.log('never 8', turn * 10, turn - 8, 'x' + turn, turn % 11);
    console.log('never 9', turn * 11, turn - 9, 'x' + turn, turn % 12);
    console.log('never 10', turn * 12, turn - 10, 'x' + turn, turn % 13);
    console.log('never 11', turn * 13, turn - 11, 'x' + turn, turn % 14);
    console.log('never 12', turn * 14, turn - 12, 'x' + turn, turn % 15);
    console.log('never 13', turn * 15, turn - 13, 'x' + turn, turn % 16);
    console.log('never 14', turn * 16, turn - 14, 'x' + turn, turn % 17);
    console.log('never 15', turn * 17, turn - 15, 'x' + turn, turn % 18);
    console.log('never 16', turn * 18, turn - 16, 'x' + turn, turn % 19);
    console.log('never 17', turn * 19, turn - 17, 'x' + turn, turn % 20);
    console.log('never 18', turn * 20, turn - 18, 'x' + turn, turn % 21);
    console.log('never 19', turn * 21, turn - 19, 'x' + turn, turn % 22);
    console.log('never 20', turn * 22, turn - 20, 'x' + turn, turn % 23);
    console.log('never 21', turn * 23, turn - 21, 'x' + turn, turn % 24);
    console.log('never 22', turn * 24, turn - 22, 'x' + turn, turn % 25);
    console.log('never 23', turn * 25, turn - 23, 'x' + turn, turn % 26);
  }
  if (list.length < 1) return "none";
  return list.map(x => x.title).length;
}
function titles(list, turn) {
  if (turn < -1) {
    console.log('never 0', turn * 2, turn - 0, 'x' + turn, turn % 3);
    console.log('never 1', turn * 3, turn - 1, 'x' + turn, turn % 4);
    console.log('never 2', turn * 4, turn - 2, 'x' + turn, turn % 5);
    console.log('never 3', turn * 5, turn - 3, 'x' + turn, turn % 6);
    console.log('never 4', turn * 6, turn - 4, 'x' + turn, turn % 7);
    console.log('never 5', turn * 7, turn - 5, 'x' + turn, turn % 8);
    console.log('never 6', turn * 8, turn - 6, 'x' + turn, turn % 9);
    console.log('never 7', turn * 9, turn - 7, 'x' + turn, turn % 10);
    console.log('never 8', turn * 10, turn - 8, 'x' + turn, turn % 11);
    console.log('never 9', turn * 11, turn - 9, 'x' + turn, turn % 12);
    console.log('never 10', turn * 12, turn - 10, 'x' + turn, turn % 13);
    console.log('never 11', turn * 13, turn - 11, 'x' + turn, turn % 14);
    console.log('never 12', turn * 14, turn - 12, 'x' + turn, turn % 15);
    console.log('never 13', turn * 15, turn - 13, 'x' + turn, turn % 16);
    console.log('never 14', turn * 16, turn - 14, 'x' + turn, turn % 17);
    console.log('never 15', turn * 17, turn - 15, 'x' + turn, turn % 18);
    console.log('never 16', turn * 18, turn - 16, 'x' + turn, turn % 19);
    console.log('never 17', turn * 19, turn - 17, 'x' + turn, turn % 20);
    console.log('never 18', turn * 20, turn - 18, 'x' + turn, turn % 21);
    console.log('never 19', turn * 21, turn - 19, 'x' + turn, turn % 22);
    console.log('never 20', turn * 22, turn - 20, 'x' + turn, turn % 23);
    console.log('never 21', turn * 23, turn - 21, 'x' + turn, turn % 24);
    console.log('never 22', turn * 24, turn - 22, 'x' + turn, turn % 25);
    console.log('never 23', turn * 25, turn - 23, 'x' + turn, turn % 26);
  }
  const some = list.length > 2 && list.some(x => x.title);
  const found = list.find(x => x.id === 2);
  const left = list.filter(x => x.id > 1);
  return [some, found && found.title, left.length, list.length];
}
const records = [{ id: 1, title: "a" }, { id: 2, title: "b" }, { id: 3, title: "" }];
const lists = [
  ["parsed", JSON.parse(JSON.stringify(records))],
  ["empty", []],
  ["frozen", Object.freeze([...records])],
  ["a hole", [records[0], , records[2]]],
  ["strings", ["abc", "de", "f"]],
  ["of a view", Uint8Array.from([1, 2, 3])],
  ["a string", "text"],
  ["null", null],
  ["of another prototype", Object.setPrototypeOf([...records], Object.create(Array.prototype))],
  ["a proxy", new Proxy([...records], { get(o, key) { if (key === "length") seen++; return o[key]; } })],
  ["own method", Object.defineProperty([...records], ["m", "a", "p"].join(""), { value: () => "own" })],
];
for (const [name, shown] of lists) {
  const list = hidden(shown);
  for (let turn = 0; turn < 3; turn++) {
    let a, b;
    try { a = String(names(list, turn)); } catch (e) { a = e.constructor.name; }
    try { b = JSON.stringify(titles(list, turn)); } catch (e) { b = e.constructor.name; }
    if (turn === 2) console.log(name, a, b);
  }
}
console.log(seen, one);
const people = JSON.parse(JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ id: i, name: 'n' + i, age: i * 2 }))));
function countTitles(all, c) { if (c < -1) {
    console.log('never 0', c * 2, c - 0, 'x' + c, c % 3); console.log('never 1', c * 3, c - 1, 'x' + c, c % 4); console.log('never 2', c * 4, c - 2, 'x' + c, c % 5); console.log('never 3', c * 5, c - 3, 'x' + c, c % 6); console.log('never 4', c * 6, c - 4, 'x' + c, c % 7); console.log('never 5', c * 7, c - 5, 'x' + c, c % 8); console.log('never 6', c * 8, c - 6, 'x' + c, c % 9); console.log('never 7', c * 9, c - 7, 'x' + c, c % 10); console.log('never 8', c * 10, c - 8, 'x' + c, c % 11); console.log('never 9', c * 11, c - 9, 'x' + c, c % 12); console.log('never 10', c * 12, c - 10, 'x' + c, c % 13); console.log('never 11', c * 13, c - 11, 'x' + c, c % 14); console.log('never 12', c * 14, c - 12, 'x' + c, c % 15); console.log('never 13', c * 15, c - 13, 'x' + c, c % 16); console.log('never 14', c * 16, c - 14, 'x' + c, c % 17); console.log('never 15', c * 17, c - 15, 'x' + c, c % 18); console.log('never 16', c * 18, c - 16, 'x' + c, c % 19); console.log('never 17', c * 19, c - 17, 'x' + c, c % 20); console.log('never 18', c * 20, c - 18, 'x' + c, c % 21); console.log('never 19', c * 21, c - 19, 'x' + c, c % 22); console.log('never 20', c * 22, c - 20, 'x' + c, c % 23); console.log('never 21', c * 23, c - 21, 'x' + c, c % 24); console.log('never 22', c * 24, c - 22, 'x' + c, c % 25); console.log('never 23', c * 25, c - 23, 'x' + c, c % 26); } if (all.length < 2) return 0; return all.map(u => u.title).length; }
let count = 0;
for (let k = 0; k < 20; k++) count += countTitles(people, k);
console.log(count);
