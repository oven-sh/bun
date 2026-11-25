import vm from "node:vm";

const got = "got";
globalThis.getter = function () {
  return got;
};

function make(i) {
  const made = { a: i, b: "b" + i };
  Object.defineProperty(made, "a", { value: i, writable: true, enumerable: false, configurable: true });
  return made;
}

// No clock decides what is printed: a turn in which the script was cut short in front of the generator's first step is passed over.
let entered = false;
function* spin() {
  entered = true;
  for (let n = 0; n < 1e9; n++) if (n === -1) yield n;
}

function stateOf(held) {
  try {
    return held.next().done ? 1 : 2;
  } catch (error) {
    return error instanceof TypeError ? 0 : 3;
  }
}

function read(one) {
  return one.a;
}

function readAdded(one) {
  const held = one.c;
  return held === undefined ? undefined : stateOf(held);
}

globalThis.deed = function (each) {
  each.c = spin();
  each.c.next();
};
const script = new vm.Script("for (const each of list) deed(each);");
const turns = process.argv.length > 2 ? Number(process.argv[2]) : 200;
let timeouts = 0;
let wrong = 0;
let sum = 0;
for (let turn = 0; turn < turns; turn++) {
  entered = false;
  const list = [];
  for (let i = 0; i < 4000; i++) list.push(make(i));
  for (const each of list) sum += read(each);
  for (const each of list) if (readAdded(each) !== undefined) wrong++;
  globalThis.list = list;
  try {
    script.runInThisContext({ timeout: 1 });
  } catch (error) {
    if (error.code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw error;
    timeouts++;
  }
  for (const each of list) {
    const descriptor = Reflect.getOwnPropertyDescriptor(each, "a");
    const truth = descriptor.get ? got : descriptor.value;
    if (read(each) !== truth) wrong++;
    const added = Reflect.getOwnPropertyDescriptor(each, "c");
    if (added !== undefined && !entered) continue;
    if (readAdded(each) !== (added === undefined ? undefined : 0)) wrong++;
  }
}
console.log("SAID", sum === turns * 7998000, timeouts > 0, wrong);
process.exit(0);
