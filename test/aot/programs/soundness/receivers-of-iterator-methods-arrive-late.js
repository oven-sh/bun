// The receiver of a method that answers an iterator arrives late, and so does what the receiver holds.
function run(f) { "x".replace("x", f); }
function main() {
  let list = [1, 2];
  function swap() { list = [{ o: 1 }]; return ""; }
  for (let i = 0; i < 2; i++) {
    const it = list.values();
    const step = it.next();
    console.log(typeof step.value, step.done);
    for (const [index, value] of list.entries()) console.log(index, typeof value);
    run(swap);
  }
  let map = new Map();
  map.set("k", 1);
  function other() { map = new Map(); map.set({ key: 1 }, "v"); return ""; }
  for (let i = 0; i < 2; i++) {
    for (const k of map.keys()) console.log(typeof k);
    for (const v of map.values()) console.log(typeof v);
    const first = map.entries().next().value;
    console.log(typeof first[0], typeof first[1]);
    run(other);
  }
  const grown = new Set();
  const walker = grown.values();
  grown.add({ late: 1 });
  console.log(typeof walker.next().value);
}
main();
