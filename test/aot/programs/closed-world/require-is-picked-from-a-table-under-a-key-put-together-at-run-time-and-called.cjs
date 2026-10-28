// A table holds require beside a function of the program. A function reads the table under a key that is put together at run time, and what it returns is called where it is returned.
const table = { load: require, other: a => ({ Socket: a }) };
const pick = name => table[name];
try {
  console.log(typeof pick("load other".split(" ")[0])("node:net".trim()).Socket);
} catch (error) {
  console.log(error.name, error.code);
}
