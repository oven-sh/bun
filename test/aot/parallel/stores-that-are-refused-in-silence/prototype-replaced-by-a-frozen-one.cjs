const E = {};
Object.setPrototypeOf(E, Object.freeze({ a: "above" }));
E.a = "own";
console.log(E.a, Object.keys(E).length);
