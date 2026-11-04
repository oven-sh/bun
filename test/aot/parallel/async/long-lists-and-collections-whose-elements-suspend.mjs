// The list, the map and the set are alive across the awaits and yields of their own elements.
const later = value => new Promise(resolve => setTimeout(resolve, 0, value));
async function lists() {
  const awaited = [await later(0), await 1, await 2, await later(3), await 4, await 5, await later(6), await 7, await 8, await later(9), await 10, await 11, await later(12), await 13, await 14, await later(15), await 16, await 17, await later(18), await 19, await 20, await later(21), await 22, await 23, await later(24), await 25, await 26, await later(27), await 28, await 29, await later(30), await 31, await 32, await later(33), await 34, await 35, await later(36), await 37, await 38, await later(39)];
  const map = new Map([[await later(0), await 0], [await later(1), await 1], [await later(2), await 2], [await later(3), await 3], [await later(4), await 4], [await later(5), await 5], [await later(6), await 6], [await later(7), await 7], [await later(8), await 8], [await later(9), await 9], [await later(10), await 10], [await later(11), await 11], [await later(12), await 12], [await later(13), await 13], [await later(14), await 14], [await later(15), await 15], [await later(16), await 16], [await later(17), await 17], [await later(18), await 18], [await later(19), await 19], [await later(20), await 20], [await later(21), await 21], [await later(22), await 22], [await later(23), await 23], [await later(24), await 24], [await later(25), await 25], [await later(26), await 26], [await later(27), await 27], [await later(28), await 28], [await later(29), await 29], [await later(30), await 30], [await later(31), await 31], [await later(32), await 32], [await later(33), await 33], [await later(34), await 34], [await later(35), await 35], [await later(36), await 36], [await later(37), await 37], [await later(38), await 38], [await later(39), await 39]]);
  const set = new Set([await later(0), await later(1), await later(2), await later(3), await later(4), await later(5), await later(6), await later(7), await later(8), await later(9), await later(10), await later(11), await later(12), await later(13), await later(14), await later(15), await later(16), await later(17), await later(18), await later(19), await later(20), await later(21), await later(22), await later(23), await later(24), await later(25), await later(26), await later(27), await later(28), await later(29), await later(30), await later(31), await later(32), await later(33), await later(34), await later(35), await later(36), await later(37), await later(38), await later(39)]);
  return [awaited.length, awaited[39], map.size, map.get(39), set.size, [...set][39]].join(",");
}
function* yields() {
  const list = [yield 0, yield 1, yield 2, yield 3, yield 4, yield 5, yield 6, yield 7, yield 8, yield 9, yield 10, yield 11, yield 12, yield 13, yield 14, yield 15, yield 16, yield 17, yield 18, yield 19, yield 20, yield 21, yield 22, yield 23, yield 24, yield 25, yield 26, yield 27, yield 28, yield 29, yield 30, yield 31, yield 32, yield 33, yield 34, yield 35, yield 36, yield 37, yield 38, yield 39];
  const map = new Map([[yield "k1", yield "v1"], [yield "k2", yield "v2"]]);
  return list.join("") + "|" + [...map].join(";");
}
async function rejected() {
  try {
    return [await 0, await 1, await 2, await 3, await 4, await 5, await 6, await 7, await 8, await 9, await 10, await 11, await 12, await 13, await 14, await 15, await 16, await 17, await 18, await 19, await 20, await 21, await 22, await 23, await 24, await 25, await 26, await 27, await 28, await 29, await 30, await 31, await 32, await 33, await 34, await 35, await Promise.reject("at 36"), await 37, await 38, await 39];
  } catch (error) {
    return "caught " + error;
  }
}
console.log(await lists(), await Promise.all([lists(), lists()]).then(both => both[0] === both[1]));
const steps = yields();
let step = steps.next(), sent = 0;
while (!step.done) step = steps.next(String.fromCharCode(97 + sent++ % 26));
console.log(step.value);
console.log(await rejected());
const abandoned = yields();
abandoned.next(); for (let i = 0; i < 35; i++) abandoned.next(i);
console.log(JSON.stringify(abandoned.return("left")));
