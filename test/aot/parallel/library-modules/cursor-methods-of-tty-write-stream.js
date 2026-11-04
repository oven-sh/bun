const methods = require("node:tty").WriteStream.prototype;
const stream = {
  write(text, done) {
    console.log(JSON.stringify(text), typeof done);
    return true;
  },
};
console.log(methods.clearLine.call(stream, 0), methods.cursorTo.call(stream, 1, 2));
console.log(methods.moveCursor.call(stream, 1, -1), methods.clearScreenDown.call(stream));
