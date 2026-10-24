// With --pending-deprecation a store of anything but a string, a number or a boolean into process.env warns once.
// The printed line names the process id and the executable, which differ from run to run.
process.pid = 1;
process.argv0 = "program";
process.env.FIRST = {};
process.env.SECOND = [];
console.log(process.env.FIRST, process.env.SECOND === "");
