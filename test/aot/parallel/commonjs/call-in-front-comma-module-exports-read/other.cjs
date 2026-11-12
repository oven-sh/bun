const log = [];
function said() {
  log.push("said");
}
function tell(name, value) {
  console.log(name, log.join(), JSON.stringify(value));
  log.length = 0;
}
tell("type", typeof (said(), module).exports);
(said(), module).exports.two = 2;
tell("store", exports.two);
Object.defineProperty((said(), module).exports, "twelve", { value: 12, enumerable: true });
tell("definition", exports.twelve);
(said(), module).exports;
tell("statement", 0);
(said(), module).exports.two;
tell("member", 0);
void (said(), module).exports;
tell("void", 0);
if ((said(), module).exports) tell("test", 0);
tell("read", (said(), module).exports.two);
tell("optional", (said(), module)?.exports.two);
tell("same", (said(), module).exports === exports);
(said(), exports).three = 3;
tell("exports", exports.three);
(said(), module.exports).four = 4;
tell("module.exports", exports.four);
