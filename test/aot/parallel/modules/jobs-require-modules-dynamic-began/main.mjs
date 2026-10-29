// import() begins to load nine modules at once. The first is required one job later, the second two jobs later, and so on: each require() finds the load of its module one step further on, and returns the module. Plain Bun prints another output.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
function after(jobs, start) {
  if (jobs === 0) start();
  else Promise.resolve().then(() => after(jobs - 1, start));
}
const lines = [];
let unsettled = 18;
function settle(line) {
  lines.push(line);
  if (--unsettled === 0) console.log(lines.sort().join("\n"));
}
for (let jobs = 1; jobs <= 9; jobs++) {
  import(`./module${jobs}.mjs`).then(
    () => settle(`module${jobs} is imported`),
    error => settle(`module${jobs} is rejected: ${error.name}`),
  );
  after(jobs, () => {
    try {
      settle(`module${jobs} is required: ` + Object.keys(require(`./module${jobs}.mjs`)));
    } catch (error) {
      settle(`module${jobs} is required: ${error.name}`);
    }
  });
}
/* Output:
module1 is imported
module1 is required: value1
module2 is imported
module2 is required: value2
module3 is imported
module3 is required: value3
module4 is imported
module4 is required: value4
module5 is imported
module5 is required: value5
module6 is imported
module6 is required: value6
module7 is imported
module7 is required: value7
module8 is imported
module8 is required: value8
module9 is imported
module9 is required: value9
*/
