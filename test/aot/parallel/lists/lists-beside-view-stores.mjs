// What is known of a list that is made here outlives a store into a view, in a generator's loop that is built twice too: the build ended under proof-checks.
function* downward(array, otherArray, start, end) {
  const output = new Float64Array(array.length + 2);
  let sum = 0;
  let best = -1;
  let count = 0;
  let joined = "";
  let lastIndex = -2;
  let i1 = array.length - 1;
  do {
    sum += array[i1] * 2;
    output[i1] = best;
    best = array[i1] > best ? array[i1] : best;
    i1--;
  } while (i1 >= 0);
  yield [sum, best, count, lastIndex].join() + " | " + joined + " | " + Array.from(output).join();
}
console.log([...downward(Array.from(JSON.parse("[]")), Array.from(JSON.parse("[3,-1,2,-5,4]")), 0, 3)].join());
console.log([...downward(Array.from(JSON.parse("[3,-1,2,-5,4]")), [], 0, 3)].join());

function* summed(array) {
  const output = new Int32Array(4);
  let sum = 0;
  let i = array.length - 1;
  while (i >= 0) {
    sum += array[i];
    output[i] = 7;
    i--;
  }
  yield sum;
  yield output.join();
}
console.log([...summed(Array.from(JSON.parse("[]")))].join(), [...summed(Array.from(JSON.parse('[1,2.5,"x"]')))].join(), [0, ...summed(Array.from(JSON.parse("[4]"))), 1].length);

function views(bytes) {
  const list = [1, 2, 3];
  const buffer = new ArrayBuffer(8);
  const one = new Uint8Array(buffer);
  const other = new Uint16Array(buffer);
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    one[i] = i + 1;
    list[i] = other[0];
    other[1] = 515;
    sum += one[2] * 10 + list.length + bytes[i];
  }
  return [sum, list.join(), one.join(), other[1], list.length].join(" ");
}
console.log(views(new Uint8Array([9, 8, 7, 6])));
console.log(views([1, 2, 3, 4]));

function counted() {
  const view = new Uint8Array(3);
  const found = [];
  for (let i = 0; i < 3; i++) {
    view[i] = 5;
    found.push(view[i], found.length);
    view[2 - i] = 9;
    found[0] += view[0];
  }
  return found.join() + ":" + arguments.length;
}
console.log(counted(1, 2));
