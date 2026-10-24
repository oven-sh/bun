const source = { 0: 0, 2: 2, 3: 3, length: 4, [Symbol.iterator]: Array.prototype[Symbol.iterator] };
Object.setPrototypeOf(source, { get 1() { source.length = 0; return 1; } });
console.log(new Int32Array(source).join());
