const at = JSON.parse("0");
const held = [];
function lay(value) {
  const into = held[at];
  for (let i = 0; i < 12; i++) into[i] = value;
}
function fill(holders, value) {
  held[0] = holders[0];
  lay(value);
  return holders[0];
}
const said = [];
said.push(JSON.stringify(fill([{}], 1)));
said.push(JSON.stringify(fill([{ length: 2, 1: "kept" }], 2)));
for (const primitive of ["text", "", 5, true, Symbol.iterator, 5n]) {
  try {
    said.push(String(fill([primitive], 3)));
  } catch (error) {
    said.push(error.constructor.name);
  }
}
function named() {}
said.push(Object.keys(fill([named], 6)).join());
const log = [];
fill(
  [
    new Proxy(
      {},
      {
        set(target, key, value) {
          log.push(`${typeof key} ${key} ${value}`);
          return true;
        },
      },
    ),
  ],
  7,
);
said.push(log.join());
for (const nothing of [undefined, null]) {
  try {
    fill([nothing], 8);
    said.push("no error");
  } catch (error) {
    said.push(error.constructor.name);
  }
}
class Rows extends Array {}
const rows = fill([new Rows(2)], 9);
said.push(`${rows.constructor.name} ${rows.length} ${rows.join()}`);
class Bytes extends Uint8Array {}
const bytes = fill([new Bytes(2)], 260);
said.push(`${bytes.constructor.name} ${bytes.length} ${bytes.join()}`);
(function () {
  said.push(`${fill([arguments], 10).length} ${Array.from(arguments).join()} ${arguments[3]}`);
})(1, 2);
said.push(fill([[1, 2]], 11).join());
said.push(fill([new Float64Array(3)], 1.25).join());
said.push(fill([new Int16Array(3)], "12").join());
console.log(
  said.join(`
`),
);
