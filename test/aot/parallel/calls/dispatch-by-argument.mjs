const commands = {
  start(report) { return { go() { report("started"); } }; },
  stop(report) { return { go() { report("stopped"); } }; },
};
const name = process.argv[2] ?? "start";
let said = "nothing";
commands[name](text => { said = text; }).go();
console.log(said);
