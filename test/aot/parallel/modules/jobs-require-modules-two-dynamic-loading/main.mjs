// import() begins to load nine modules at once, and a second import() of each follows one job ahead of the require() of it. Each require() finds the two loads of its module one step further on, and returns the module. Plain Bun prints another output.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
function after(jobs, start) {
  if (jobs === 0) start();
  else Promise.resolve().then(() => after(jobs - 1, start));
}
const lines = [];
let unsettled = 27;
function settle(line) {
  lines.push(line);
  if (--unsettled === 0) console.log(lines.sort().join("\n"));
}
const load = (name, call) =>
  import(`./${name}.mjs`).then(
    () => settle(`${name} is imported, call ${call}`),
    error => settle(`${name} is rejected, call ${call}: ${error.name}`),
  );
for (let jobs = 1; jobs <= 9; jobs++) {
  const name = "module" + jobs;
  load(name, 1);
  after(jobs - 1, () => load(name, 2));
  after(jobs, () => {
    try {
      settle(`${name} is required: ` + Object.keys(require(`./${name}.mjs`)));
    } catch (error) {
      settle(`${name} is required: ${error.name}`);
    }
  });
}
/* Output:
module1 is imported, call 1
module1 is imported, call 2
module1 is required: value1
module2 is imported, call 1
module2 is imported, call 2
module2 is required: value2
module3 is imported, call 1
module3 is imported, call 2
module3 is required: value3
module4 is imported, call 1
module4 is imported, call 2
module4 is required: value4
module5 is imported, call 1
module5 is imported, call 2
module5 is required: value5
module6 is imported, call 1
module6 is imported, call 2
module6 is required: value6
module7 is imported, call 1
module7 is imported, call 2
module7 is required: value7
module8 is imported, call 1
module8 is imported, call 2
module8 is required: value8
module9 is imported, call 1
module9 is imported, call 2
module9 is required: value9
*/
