import vm from "node:vm";

// No clock decides what is printed: a turn in which the script was cut short in front of the generator's first step is passed over.
let entered = false;
function* spin() {
  entered = true;
  for (let n = 0; n < 1e9; n++) if (n === -1) yield n;
}
globalThis.spin = spin;

function stateOf(held) {
  try {
    return held.next().done ? "done" : "goes on";
  } catch (error) {
    return error instanceof TypeError ? "TypeError" : "other";
  }
}

const script = new vm.Script("held = spin(); held.next();");
const turns = process.argv.length > 2 ? Number(process.argv[2]) : 100;
let timeouts = 0;
let judged = 0;
const said = {};
for (let turn = 0; turn < turns; turn++) {
  globalThis.held = undefined;
  entered = false;
  try {
    script.runInThisContext({ timeout: 1 });
  } catch (error) {
    if (error.code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw error;
    timeouts++;
  }
  if (!entered) continue;
  judged++;
  const state = stateOf(globalThis.held);
  if (state !== "TypeError") said[state] = (said[state] ?? 0) + 1;
}
console.log("SAID", timeouts === turns, judged > 0, JSON.stringify(said));
process.exit(0);
