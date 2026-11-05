// require() of one file in several arms of a function, in loops and under try: the file runs once. So does a file that throws: every later require throws the same error. Under `bun run` such a file runs again at every require, so the expected output is written down.
const { log } = require("./log.js");
const arms = way => {
  let sum = 0;
  if (way === 0) sum += require("./one.js").value;
  else sum += require("./two.js").value + require("./one.js").value;
  sum += require("./one.js").value;
  for (let i = 0; i < 2; i++) sum += require("./two.js").value;
  return sum + require("./two.js").value;
};
const guarded = () => {
  const said = [];
  for (let i = 0; i < 2; i++) { try { said.push(require("./broken.js").value); } catch (error) { said.push(error.message); } }
  try { said.push(require("./broken.js").value); } catch (error) { said.push("then " + error.message); }
  try { require("./broken.js"); said.push("not reached"); } catch (error) { said.push("last " + error.message); try { require("./broken.js"); } catch (again) { said.push("inside the handler " + again.message); } }
  return said.join(" | ");
};
log.push("main runs");
log.push("arms " + [arms(1), arms(0), arms(1)].join());
log.push(guarded());
log.push(guarded());
let total = 0;
for (let i = 0; i < 20000; i++) total += arms(i & 1);
log.push("many " + total);
console.log(log.join("\n"));
/* Output:
main runs
two runs
one runs
arms 10,8,10
broken runs
broken, with 5 lines in the log | broken, with 5 lines in the log | then broken, with 5 lines in the log | last broken, with 5 lines in the log | inside the handler broken, with 5 lines in the log
broken, with 5 lines in the log | broken, with 5 lines in the log | then broken, with 5 lines in the log | last broken, with 5 lines in the log | inside the handler broken, with 5 lines in the log
many 180000
*/
