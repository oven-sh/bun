const m = new Map([["a", 1]]), l = ["a"];
console.log(m.get(...l));
l[0] = "z";
console.log(m.get(...l), m.get.apply(m, l), m.get.call(m, ...["a"]));
export {};
