// adds to a cell of a shared Int32Array with Atomics.add and reads another with Atomics.load
const operations = 100;
const slots = new Int32Array(new SharedArrayBuffer(64));
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    Atomics.add(slots, 0, 1);
    total += Atomics.load(slots, 4);
  }
}

console.log(total, slots[0]);
