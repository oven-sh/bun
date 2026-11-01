// Flags: --aot-check=verify-each-stage
// filter() keeps nothing, so the list that it made has the length it was made with, and map() reads that length: the read becomes that number, of a narrower type.
const list = [3];
setTimeout(() => {
  const mapped = list
    .filter(value => {
      log.push("f" + value);
    })
    .map(value => value + 1);
  console.log(mapped.length, log.join());
}, 0);
globalThis.log = [];
