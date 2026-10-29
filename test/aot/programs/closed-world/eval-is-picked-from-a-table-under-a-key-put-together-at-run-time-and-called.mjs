// A table holds eval beside a function of the program. A function reads the table under a key that is put together at run time, and what it returns is called where it is returned.
const table = { run: eval, other: a => a + 1 };
const pick = name => table[name];
try {
  console.log(pick("run other".split(" ")[0])("1 + 1"));
} catch (error) {
  console.log(error.name);
}
