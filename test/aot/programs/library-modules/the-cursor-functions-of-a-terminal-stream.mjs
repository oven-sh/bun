// The four cursor functions of tty.WriteStream write what the functions of node:readline with the same names write.
import tty from "node:tty";
import readline from "node:readline";
function record() {
  const written = [];
  return {
    written,
    write(text, callback) {
      written.push(JSON.stringify(text));
      if (callback) callback();
      return true;
    },
  };
}
const throughStream = record();
const throughModule = record();
const { cursorTo, moveCursor, clearLine, clearScreenDown } = tty.WriteStream.prototype;
let calls = 0;
cursorTo.call(throughStream, 1, 2, () => calls++);
moveCursor.call(throughStream, -1, 3);
clearLine.call(throughStream, 0);
clearScreenDown.call(throughStream, () => calls++);
readline.cursorTo(throughModule, 1, 2);
readline.moveCursor(throughModule, -1, 3);
readline.clearLine(throughModule, 0);
readline.clearScreenDown(throughModule);
console.log(throughStream.written.join(" "), calls, throughStream.written.join() === throughModule.written.join());
try {
  cursorTo.call(throughStream, "x");
} catch (error) {
  console.log(error.code);
}
