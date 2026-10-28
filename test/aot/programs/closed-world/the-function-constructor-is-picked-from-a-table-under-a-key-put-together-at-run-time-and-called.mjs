// A table holds Function beside a function of the program. A function reads the table under a key that is put together at run time, and what it returns is called where it is returned.
const table = { make: Function, other: a => () => a };
const pick = name => table[name];
try {
  console.log(pick("make other".split(" ")[0])("return 2")());
} catch (error) {
  console.log(error.name);
}
