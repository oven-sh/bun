// Exit code: 1
function print(text) {
  console.log(text);
}
function str(v) {}
const Readable = require("node:stream");

class B extends Middle {
  text = "ok";
  m() {
    return "B.m " + this.text;
  }
}
function report(label, x) {
  print(label + " $.m(): " + str(x.m()));
  print(label + " $.text: " + str(x.text));
  printlabel + " values: " + Object.values(x).map.join;
}
try {
  report();
} catch (e) {}
try {
  report("o", new B());
} catch (e) {}
try {
} catch (e) {}
