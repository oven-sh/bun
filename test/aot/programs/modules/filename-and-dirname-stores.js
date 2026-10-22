// An ES module stores to `__filename` and `__dirname`: each is a variable of the module that starts as `import.meta.path` and `import.meta.dir`, which the stores leave as they are.
export function readFilename() {
  return __filename;
}
export function storeDirname(value) {
  __dirname = value;
}

console.log(__filename === import.meta.path, __dirname === import.meta.dir, readFilename() === import.meta.path);
__filename = "stored";
console.log(__filename, readFilename(), import.meta.path === "stored");
storeDirname("stored by a function");
console.log(__dirname, import.meta.dir === __dirname);
__filename += "!";
console.log(readFilename(), typeof __filename);
for (let index = 0; index < 3; index++) {
  if (index === 1) continue;
  __filename = index;
}
console.log(__filename, readFilename());
[__filename, __dirname] = ["first", "second"];
console.log(__filename, __dirname);
