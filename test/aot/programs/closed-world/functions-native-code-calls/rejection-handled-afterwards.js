// With --unhandled-rejections=warn a promise that gets its handler after it was reported is one more warning.
// The printed line names the process id and the executable, which differ from run to run.
process.pid = 1;
process.argv0 = "program";
const rejected = Promise.reject(7);
setTimeout(() => {
  rejected.catch(reason => console.log("caught " + reason));
}, 5);
