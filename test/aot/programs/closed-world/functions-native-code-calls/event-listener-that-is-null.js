// addEventListener warns about a listener that is null or undefined.
// The printed line names the process id and the executable, which differ from run to run.
process.pid = 1;
process.argv0 = "program";
const target = new EventTarget();
target.addEventListener("first", null);
target.addEventListener("second", undefined);
console.log(target.dispatchEvent(new Event("first")));
