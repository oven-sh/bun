function read(of, name) { return typeof of[name]; }
read({}, "a");
console.log(read(module, ["req", "uire"].join("")), read(module, "paths"), read(module, "children"));
