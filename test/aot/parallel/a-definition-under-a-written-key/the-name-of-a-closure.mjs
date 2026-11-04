function f() {}
function act() { Object.defineProperty(f, "name", { value: "other" }); }
console.log(f.name);
act();
console.log(f.name, f.length);
