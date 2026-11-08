import vm from "node:vm";

function* spin() {
  for (let n = 0; n < 1e9; n++) if (n === -1) yield n;
}
globalThis.spin = spin;

function stateOf(held) {
  try {
    return held.return(7).done ? "done" : "goes on";
  } catch (error) {
    return error instanceof TypeError ? "TypeError" : "other";
  }
}

globalThis.deed = function () {
  globalThis.held = spin();
  globalThis.held.next();
};

const script = new vm.Script("deed();");
const turns = process.argv.length > 2 ? Number(process.argv[2]) : 100;
let timeouts = 0;
const said = {};
for (let turn = 0; turn < turns; turn++) {
  globalThis.held = undefined;
  try {
    script.runInThisContext({ timeout: 1 });
  } catch (error) {
    if (error.code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw error;
    timeouts++;
  }
  const state = stateOf(globalThis.held);
  said[state] = (said[state] ?? 0) + 1;
}
console.log("SAID", timeouts === turns, JSON.stringify(said));
process.exit(0);
