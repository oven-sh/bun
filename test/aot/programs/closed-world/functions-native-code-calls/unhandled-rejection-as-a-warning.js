// With --unhandled-rejections=warn the run time reports a rejected promise that has no handler as two warnings. No built-in is called at that moment, and the option arrives when the executable is started.
// STATISTIC: ImageFunctionsEmitted <= 160
// The printed line names the process id and the executable, which differ from run to run.
process.pid = 1;
process.argv0 = "program";
async function fails() {
  throw 7;
}
fails();
setTimeout(() => console.log("still running"), 5);
