// A program keeps functions and objects on `process`, and on the native prototype above it, under names that native code never looks up. Only the program finds them: it reads them back, calls them, lists and deletes them.
const say = (...values) => console.log(...values);
class Registry { entries = []; add(entry) { this.entries.push(entry); return this; } }

process.helper = function (value) { return [this === process, value * 2]; };
process.registry = new Registry().add("first");
const nativePrototype = Object.getPrototypeOf(process);
nativePrototype.inherited = function () { return ["inherited", this === process]; };
Object.defineProperty(nativePrototype, "computed", { get() { return ["computed", this === process]; }, configurable: true });

say(process.helper(21), process.registry.add("second").entries.join(), process.inherited(), process.computed);
const name = ["hel", "per"].join("");
say(process[name](4), name in process, Object.hasOwn(process, name), Object.hasOwn(process, "inherited"), "inherited" in process);
say(Object.keys(process).filter(key => key === "helper" || key === "registry").join(), Object.keys(nativePrototype).includes("inherited"));
const { helper, registry } = process;
say(typeof helper, registry instanceof Registry, helper.call(process, 1));
say(delete process.helper, process.helper, delete nativePrototype.inherited, process.inherited, delete nativePrototype.computed, process.computed);

// The listener methods are still the native ones, and an event still arrives.
process.on("exit", code => say("exit", code, process.registry.entries.length));
say(process.listenerCount("exit"), Object.hasOwn(nativePrototype, "on"), typeof process.emit);
