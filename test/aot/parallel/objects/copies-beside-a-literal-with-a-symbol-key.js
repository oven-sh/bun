// The source of the copies is of no known layout, so the records of the program are candidates, and one has a key that is a symbol: a key without a text. The compiler died here.
const log = [];
const r2 = Object.assign(() => 0, { [Symbol.dispose]() { log.push("f"); } });
for (let hot = 0; hot < 1; hot++) {
  const o = JSON.parse('{"0":0,"1":1}');
  log.push(Object.keys(Object.assign({}, o)).join());
  const { 0: first, ...rest } = o;
  log.push(Object.keys(rest).join());
}
console.log(log.join(" "));
