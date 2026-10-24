// Native code prints a warning with a function of Bun's own library, on a tick queue that another one makes. Nothing else in this program uses either: setTimeout and setInterval warn about a delay that is too large, negative or no number.
// The printed line names the process id and the executable, which differ from run to run.
process.pid = 1;
process.argv0 = "program";
setTimeout(() => console.log("too large"), 2 ** 40);
setTimeout(() => console.log("negative"), -5);
const interval = setInterval(() => {
  console.log("no number");
  clearInterval(interval);
}, NaN);
