const handlers = { data(tag, x) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]; return s; }, end(tag) { return tag; } };
function emit(name, ...args) { return handlers[name](...args); }
console.log(emit("data", "t", Buffer.from([1, 2, 3])), emit("end", "u"));
