const methods = require("node:tty").WriteStream.prototype;
const stream = {
  write(text, done) {
    console.log(JSON.stringify(text), typeof done);
    return true;
  },
};
console.log(methods.clearLine.call(stream, 0));
const readline = require("node:readline");
readline.clearLine = (given, direction) => "replaced " + direction + " " + (given === stream);
console.log(methods.clearLine.call(stream, 1), methods.cursorTo.call(stream, 3));
