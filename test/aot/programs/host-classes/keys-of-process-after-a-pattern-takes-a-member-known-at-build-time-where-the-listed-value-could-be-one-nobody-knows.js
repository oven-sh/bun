// `arch` and `platform` are known at build time. A pattern, brackets and a variable still read them, and process adds a member where it is first read.
const { arch } = process;
const host = process;
const platform = host["plat" + (process.argv.length > 99 ? "x" : "form")];
let listed = process;
if (process.argv.length > 5) listed = globalThis[process.argv[5]];
const copy = { ...listed };
const keys = Reflect.ownKeys(listed);
console.log(
  typeof arch,
  typeof platform,
  Object.keys(copy).length > 10,
  keys.indexOf("arch") < keys.indexOf("platform"),
  keys.indexOf("platform") < keys.indexOf("title"),
  keys.slice(0, 6).join(),
);
