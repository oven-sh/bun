// A walk that reads each member under its key names none of them, so the executable leaves out the code of the library behind them. No read throws, and nothing is reported behind the program's back:
// the builder of process.nextTick used to report its own error, which ended the program with exit code 1.

const holders = { console, process, Bun, globalThis };
const thrown = [];
let reads = 0;
for (const name of Object.keys(holders)) {
  const holder = holders[name];
  for (const key of Object.keys(holder)) {
    try {
      void holder[key];
      reads++;
    } catch (error) {
      thrown.push(name + "." + key + ": " + error.message);
    }
  }
}
console.log("reads", reads > 100, "thrown", JSON.stringify(thrown));
