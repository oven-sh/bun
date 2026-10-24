// Native code looks ten names up on `process`: emit, nextTick, reallyExit, _kill, _fatalException, stdout, stderr, stdin, noDeprecation, throwDeprecation. It finds, and calls, what a program has stored under each.
const say = (...values) => console.log(...values);

const nativeEmit = process.emit;
process.emit = function (event, ...values) {
  say("emit", String(event), this === process, values.length);
  return nativeEmit.call(this, event, ...values);
};
process.on("warning", warning => say("listener: warning", warning.name, warning.message));
process.on("beforeExit", code => say("listener: beforeExit", code));
process.on("exit", code => say("listener: exit", code));
process.on("uncaughtException", (error, origin) => say("listener: uncaughtException", error.message, origin));

const written = [];
const errorStream = { write(text) { written.push([this === errorStream, String(text).replace(/\d+/g, "N").replace(/`[^`]*`/, "`..`")]); return true; } };
process.stderr = errorStream;
say("console._stderr", console._stderr === errorStream);
const outputStream = { write() { return true; }, marker: "the program's" };
const nativeOutput = process.stdout;
process.stdout = outputStream;
say("console._stdout", console._stdout === outputStream, console._stdout.marker);
process.stdout = nativeOutput;

const inputStream = { resume() { say("stdin.resume", this === inputStream); return this; } };
process.stdin = inputStream;
say("openStdin", process.openStdin() === inputStream);

process._kill = function (pid, signal) { say("_kill", pid === process.pid, signal, this === globalThis || this === undefined); return 0; };
say("kill", process.kill(process.pid, 0));

process._fatalException = function () { say("_fatalException was called"); return true; };
process.reallyExit = function (code) { say("reallyExit", code, this === process); };

process.emitWarning("first warning");
setTimeout(() => { throw new Error("thrown in a timer"); }, 1);
setTimeout(() => {
  say("written", JSON.stringify(written));
  process.exit(0);
  say("after process.exit, which called the program's reallyExit");
}, 20);
