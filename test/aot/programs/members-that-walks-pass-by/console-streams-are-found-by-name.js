// console._stdout and console._stderr are not enumerable. A read that names one finds the stream.
const out = console._stdout;
const { _stderr: err } = console;
console.log(out === process.stdout, err === process.stderr);
console.log(typeof out.write, typeof err.write, out.fd, err.fd);
console.log("_stdout" in console, Object.hasOwn(console, "_stderr"), console.propertyIsEnumerable("_stdout"));
out.write("written through console._stdout\n");
