// The host's calls of library functions: process.stdin is built by the library on the first read, on top of a native stream; with nothing to read its "end" and "close" listeners are called without an argument; the program's own calls pass numbers.
let total = 0;

function onEnd(code: number): void {
  total += typeof code === "number" ? 1 : code === undefined ? 100 : 10000;
}
function onData(chunk: number): void {
  total += typeof chunk === "number" ? 100000 : 1000000;
}

onEnd(0);
onData(0);
process.stdin.on("data", onData as any);
process.stdin.on("end", onEnd as any);
process.stdin.on("close", onEnd as any);
process.stdin.on("close", () => console.log(total, process.stdin.readableEnded));
