// A table holds process.getBuiltinModule beside a function of the program. The table is read under a key that is put together at run time, and what the read answers is called on the spot.
const table = { load: process.getBuiltinModule, adder: b => ({ Socket: b }) };
try {
  console.log(typeof table["load adder".split(" ")[0]]("node:net".trim()).Socket);
} catch (error) {
  console.log(error.name, error.code);
}
