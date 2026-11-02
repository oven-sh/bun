// A name whose `--define` value is the `push` of a list adds a name to the list, and `require` takes each name of it: the build finds the file.
// Flags: --define ADD=names.push
const names = [];
ADD("./lib.cjs");
for (const name of names) console.log(require(name).name);
