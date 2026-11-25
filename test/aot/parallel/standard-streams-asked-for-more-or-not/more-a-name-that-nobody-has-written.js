const name = process.argv[5] ?? ["writ", "able"].join("");
console.log(process.stdout[name], Reflect.get(process.stderr, name));
