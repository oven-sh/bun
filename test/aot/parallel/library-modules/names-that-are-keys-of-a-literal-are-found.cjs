// The names of the modules stand written as keys alone: of a literal, under brackets, in the head of a loop. Object.keys() and the loop hand them on as texts to a require
// that nobody follows and to process.getBuiltinModule(). A key of more than one word that names a module of the library is held for a name that is made at run time, as a string is.
const load = [require][JSON.parse("0")];
const ask = (how, name) => {
  try {
    return typeof how(name);
  } catch (error) {
    return error.code || error.name;
  }
};
const wanted = { "node:zlib": 1, ["node:dgram"]: 2, "fs/promises": 3, "node:stream/web": 4 };
const listed = Object.keys(wanted);
const looped = [];
for (const name in { "node:tty": true, "node:readline/promises": true }) looped.push(name);
console.log(listed.concat(looped).map(name => name + " " + ask(load, name)).join("\n"));
console.log(ask(name => process.getBuiltinModule(name), listed[0]));
console.log(typeof load(listed[0]).gzipSync, load(listed[0]).gunzipSync(load(listed[0]).gzipSync("made up")).toString());
