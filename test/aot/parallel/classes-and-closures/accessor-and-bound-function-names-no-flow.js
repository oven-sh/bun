// `name` gets "get ", "set ", "bound " or "[..]" from the kind of function, never from how the name is spelled. A stack frame shows the name as written, or the computed key, until `name` or `displayName` is set on the function.
// Flags: --aot-disable=flow-results
function topFrame(run) {
  try {
    run();
  } catch (error) {
    for (const line of error.stack.split("\n")) {
      const frame = /^\s*at (?:(.*?) \()?[^()]*:\d+:\d+\)?$/.exec(line) ?? /^(?:(.*?)@)?.*:\d+:\d+$/.exec(line);
      if (frame) return frame[1] === undefined || frame[1] === "<anonymous>" ? "(anonymous)" : frame[1];
    }
  }
  return "(no frame)";
}

const computedKey = ["com", "puted"].join("");
const tag = Symbol("tag");
const bare = Symbol();

class Account {
  get total() { throw new Error("getter"); }
  set total(value) {}
  static get count() { return 0; }
  "get total"() { throw new Error("method"); }
  "bound total"() { throw new Error("method"); }
  [computedKey]() { throw new Error("computed key"); }
  [tag]() { throw new Error("symbol key"); }
  [bare]() {}
  #secret() {}
  static secretName(account) { return account.#secret.name; }
}
const account = new Account();

// Reading `name` of an accessor changes its frames in plain Bun, so every frame is printed before any `name` is read.
console.log("frame in a getter:", topFrame(() => account.total));
console.log("frame in a method named 'get total':", topFrame(() => account["get total"]()));
console.log("frame in a method named 'bound total':", topFrame(() => account["bound total"]()));
console.log("frame in a method with a computed key:", topFrame(() => account[computedKey]()));
console.log("frame in a method with a symbol key:", topFrame(() => account[tag]()));

function original() { throw new Error("original"); }
console.log("frame before a rename:", topFrame(original));
Object.defineProperty(original, "name", { value: "renamed" });
console.log("frame after a rename:", topFrame(original));

function plain() { throw new Error("plain"); }
plain.displayName = "shown";
console.log("frame with a displayName:", topFrame(plain));

function emptied() { throw new Error("emptied"); }
Object.defineProperty(emptied, "name", { value: "" });
console.log("frame after a rename to the empty string:", topFrame(emptied));

function makeWorker(id) { return function worker() { throw new Error("worker " + id); }; }
const workers = [makeWorker(1), makeWorker(2), makeWorker(3)];
Object.defineProperty(workers[0], "name", { value: "firstWorker" });
Object.defineProperty(workers[1], "name", { value: "secondWorker" });
console.log("frame in a closure beside two closures with new names:", topFrame(workers[2]));

function makeHelper(id) { return function helper() { throw new Error("helper " + id); }; }
const helpers = [makeHelper(1), makeHelper(2), makeHelper(3)];
helpers[0].displayName = "labeled";
console.log("frame in a closure beside one with a displayName:", topFrame(helpers[1]), topFrame(helpers[2]));

function steady() { throw new Error("steady"); }
steady.displayName = 7;
console.log("displayName is a number:", topFrame(steady));
steady.displayName = "";
console.log("displayName is empty:", topFrame(steady));
Object.defineProperty(steady, "displayName", { get() { return "fromGetter"; }, configurable: true });
console.log("displayName is a getter:", topFrame(steady));
Object.defineProperty(steady, "displayName", { value: "briefly", configurable: true });
console.log("displayName is a string:", topFrame(steady));
delete steady.displayName;
console.log("displayName is deleted:", topFrame(steady));

const worker = { work() { throw new Error("work"); } };
const boundWork = worker.work.bind(worker);
Object.defineProperty(boundWork, "name", { value: "handler" });
console.log("frame in a method whose bound function has a new name:", topFrame(() => worker.work()), topFrame(boundWork));
boundWork.displayName = "labeledHandler";
console.log("frame in a method whose bound function has a displayName:", topFrame(() => worker.work()), topFrame(boundWork));

function target() {}
const total = Object.getOwnPropertyDescriptor(Account.prototype, "total");
const names = [
  ["a getter", total.get],
  ["a setter", total.set],
  ["a static getter", Object.getOwnPropertyDescriptor(Account, "count").get],
  ["a method named 'get total'", account["get total"]],
  ["a method named 'bound total'", account["bound total"]],
  ["a method with a computed key", account[computedKey]],
  ["a method with a symbol key", account[tag]],
  ["a method with a symbol key without a description", account[bare]],
  ["a bound function", target.bind(null)],
  ["a bound function bound again", target.bind(null).bind(null)],
  ["a bound method named 'bound total'", account["bound total"].bind(account)],
  ["a bound getter", total.get.bind(account)],
];
for (const [what, f] of names) console.log("name of " + what + ":", JSON.stringify(f.name));
console.log("name of a private method:", JSON.stringify(Account.secretName(account)));

const literal = { [computedKey]: function () {} };
for (const [what, f] of [["a method", account[computedKey]], ["a function in an object literal", literal[computedKey]]]) {
  try {
    f.name = "stored";
  } catch {}
  console.log("name of " + what + " with a computed key after a store to it:", JSON.stringify(f.name));
}
Object.defineProperty(account[tag], "name", { writable: true });
console.log("name of a method with a symbol key after it is made writable:", JSON.stringify(account[tag].name));
