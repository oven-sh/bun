const name = ["a", "b"].join("");
globalThis[name] = 1;
console.log(globalThis[name]);
