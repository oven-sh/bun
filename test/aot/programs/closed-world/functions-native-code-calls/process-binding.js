// With --pending-deprecation process.binding warns once, and so does errname of the binding it answers for "uv".
// The printed line names the process id and the executable, which differ from run to run.
process.pid = 1;
process.argv0 = "program";
const uv = process.binding("uv");
console.log(uv.errname(-2), uv.errname(-13));
