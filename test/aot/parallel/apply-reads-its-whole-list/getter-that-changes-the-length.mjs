let calls = 0, reads = 0, lengths = 0;
function tick() { calls++; }
function shorten() {
  const list = [1, 2, 3, 4];
  Object.defineProperty(list, 0, { get() { reads++; list.length = 1; return 1; } });
  tick.apply(null, list);
  lengths += list.length;
}
function lengthen() {
  const list = [1, 2];
  Object.defineProperty(list, 1, { get() { reads++; list.push(5); return 1; } });
  Reflect.apply(tick, null, list);
  lengths += list.length;
}
for (let i = 0; i < 300; i++) shorten();
console.log(calls, reads, lengths);
for (let i = 0; i < 300; i++) lengthen();
console.log(calls, reads, lengths);
