// import() begins to load nine modules at once, and a second import() of each follows one job ahead of the require() of it. Each require() finds the two loads of its module one step further on, and returns the module. Plain Bun prints another output.
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
