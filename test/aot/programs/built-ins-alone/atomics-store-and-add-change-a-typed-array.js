const view = new Int32Array(2);
console.log(view[0]);
console.log(Atomics.store(view, 0, 5), Atomics.add(view, 0, 2));
console.log(view[0] + 1);
