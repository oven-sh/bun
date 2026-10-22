// Keys, values and receivers of Map, Set and Array methods change inside a callback of another built-in.
function run(f) { "x".replace("x", f); }
function main() {
  const m = new Map();
  let key = 1, value = "one";
  function change() { key = { k: 1 }; value = { v: 2 }; return ""; }
  const keys = [];
  for (let i = 0; i < 2; i++) { m.set(key, value); keys.push(key); run(change); }
  console.log(typeof m.get(keys[0]), typeof m.get(keys[1]), m.get(keys[1]).v, m.size);
  let store = new Map();
  const first = store;
  function other() { store = new Map(); return ""; }
  for (let i = 0; i < 2; i++) { store.set("k", i ? { late: i } : 0); run(other); }
  console.log(typeof first.get("k"), typeof store.get("k"));
  const list = [];
  let item = 1;
  function next() { item = { boxed: 1 }; return ""; }
  for (let i = 0; i < 2; i++) { list.push(item); run(next); }
  console.log(typeof list[0], typeof list[1], list[1].boxed, typeof list.pop(), typeof list.pop(), typeof list.pop());
  const s = new Set();
  for (let i = 0; i < 2; i++) { s.add(i ? item : 0); }
  let kinds = "";
  for (const e of s) kinds += typeof e;
  console.log(kinds);
}
main();
