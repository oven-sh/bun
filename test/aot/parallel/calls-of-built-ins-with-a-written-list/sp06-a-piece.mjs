const m = new Map([["bc", 2]]), t = "abcd";
console.log(m.get(...[t.slice(1, 3)]), m.get(...[t.substring(0, 2)]));
export {};
