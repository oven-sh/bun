const m = new Map([["a", 1]]);
console.log(m.get(...["b"]), m.get(...[]), m.get(...["a", 2]));
export {};
