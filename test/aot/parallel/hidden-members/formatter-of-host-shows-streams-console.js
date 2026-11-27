// Bun's own formatter, behind console.log, console.dir and Bun.inspect, shows the properties that are not enumerable only where it is asked for them: showHidden of console.dir, and %o. There it lists console._stdout as an accessor and does not read it: nothing in this program makes the stream.
const text = Bun.inspect(console);
console.log(text.includes("_stdout: WriteStream"), text.includes("_stderr: WriteStream"), text.includes("fd: 1"), text.includes("fd: 2"));
console.dir(console, { showHidden: true, depth: 0 });
