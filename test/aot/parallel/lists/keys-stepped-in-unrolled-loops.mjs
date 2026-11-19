// Under: --aot-harden=proof-checks: a key that is stepped twice in each of eight unrolled iterations lost the proof of its test, and the build stopped
function storeBack(list, from) {
  let sum = 0;
  let key = from;
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 8; i++) {
      key--;
      list[++key] = sum;
      sum += 1;
    }
  }
  return [sum, key];
}
for (const list of [[1, 2, 3, 4, 5, 6, 7], [0.5, 1.5, 2.5, 3.5], [1], [1, , 3, 4], ["a", 1, 2, 3], Object.freeze([1, 2, 3, 4]), new Uint8Array(4), Array.from({ length: 20 }, (_, i) => i % 7)]) {
  for (const from of [2, 0, -1, 3, list.length]) {
    let result;
    try {
      result = storeBack(list, from).join();
    } catch (error) {
      result = error.constructor.name;
    }
    console.log(result, list.length, Array.from(list).join());
  }
}

function stepAcross(list, other, from) {
  let sum = 0;
  let key = from;
  let back = list.length;
  for (let i = 0; i < 8; i++) {
    key += 3;
    key -= 2;
    back++;
    back -= 2;
    list[key] = other[back];
    sum += list[back] | 0;
  }
  return [sum, key, back];
}
for (const list of [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [0.5, 1.5, 2.5, 3.5], [1, 2, 3, 4, 5, 6, 7, 8]]) {
  for (const from of [-2, 0, 1]) console.log(stepAcross(list, list, from).join(), list.length, Object.keys(list).length, list.join());
}
