// Bun's own formatter, behind console.log and Bun.inspect, shows properties that are not enumerable. So it reads console._stdout, and nothing else in this program does.
const text = Bun.inspect(console);
console.log(text.includes("_stdout: WriteStream"), text.includes("_stderr: WriteStream"), text.includes("fd: 1"), text.includes("fd: 2"));
