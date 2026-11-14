const files = await new Bun.Archive({ "note.txt": "hello", "b/c.txt": "x" }).files();
const names = [];
files.forEach((file, name) => names.push(name + ":" + file.size));
console.log(names.sort().join());
