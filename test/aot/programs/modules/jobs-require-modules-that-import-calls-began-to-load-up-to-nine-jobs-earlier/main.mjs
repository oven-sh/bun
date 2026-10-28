// import() begins to load nine modules at once. The first is required one job later, the second two jobs later, and so on: each require() finds the load of its module one step further on, and returns the module. Plain Bun prints another output.
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
