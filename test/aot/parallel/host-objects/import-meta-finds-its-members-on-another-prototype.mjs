// What import.meta is asked for behind Object.setPrototypeOf is what the new prototype has: a function of the program, a number, an object, a getter.
const calls = [];
Object.setPrototypeOf(import.meta, {
  resolve(name) {
    calls.push(["resolve", this === import.meta, name]);
    return "mine " + name;
  },
  resolveSync: name => name.length,
  url: 5,
  dir: { deep: [1, 2] },
  get path() {
    calls.push(["path", this === import.meta]);
    return 7n;
  },
});
console.log(import.meta.resolve("./x.mjs"), import.meta.resolveSync("./x.mjs"));
console.log(typeof import.meta.url, import.meta.url + 1, import.meta.url === undefined, typeof import.meta.url === "string");
console.log(typeof import.meta.dir, import.meta.dir.deep.length, typeof import.meta.path, import.meta.path * 2n);
console.log(import.meta.file, import.meta.filename, import.meta.dirname, typeof import.meta.env);
console.log(JSON.stringify(calls));
