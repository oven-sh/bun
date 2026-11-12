// A method of what setTimeout() or setImmediate() returns is called many times, then replaced by a value, stored to, made an accessor, put back and deleted, each time under a name that the build cannot read: each call answers as plain Bun does. Node.js makes these methods configurable, so nothing refuses a change.
const lines: string[] = [];
function say(label: string, work: () => unknown) {
  let text: string;
  try {
    text = JSON.stringify(work()) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name + ": " + (error as Error).message;
  }
  lines.push(label + ": " + text);
}

type Timeout = ReturnType<typeof setTimeout>;
type Immediate = ReturnType<typeof setImmediate>;
const timer = setTimeout(() => {}, 1);
clearTimeout(timer);
const immediate = setImmediate(() => {});
clearImmediate(immediate);
const loose = (value: unknown): any => value;
// A method that answers its receiver is told from a stand-in that answers a text.
const same = (answer: unknown, holder: unknown): unknown => (answer === holder ? "its receiver" : answer);

const hasRefOf = (holder: Timeout): unknown => holder.hasRef();
const unrefOf = (holder: Timeout): unknown => same(holder.unref(), holder);
const immediateHasRefOf = (holder: Immediate): unknown => holder.hasRef();

function all(label: string, holder: object, name: string, typed: () => unknown, untyped: () => unknown) {
  const original = Object.getOwnPropertyDescriptor(holder, name)!;
  const both = () => [typed(), untyped()];
  const many = () => {
    let alike = 0;
    const first = JSON.stringify(both());
    for (let turn = 0; turn < 200; turn++) if (JSON.stringify(both()) === first) alike++;
    return [first, alike];
  };
  say(label + " has a descriptor that may be redefined", () => [original.configurable, original.enumerable, typeof original.value]);
  say(label + " called many times", many);
  say(label + " replaced by a value", () => (Object.defineProperty(holder, name, { value: () => "replaced", writable: true, configurable: true }), both()));
  say(label + " stored to", () => (((holder as Record<string, unknown>)[name] = () => "stored"), both()));
  say(label + " replaced by a getter", () => (Object.defineProperty(holder, name, { get: () => () => "from a getter", configurable: true }), both()));
  say(label + " put back", () => (Object.defineProperty(holder, name, original), both()));
  say(label + " deleted", () => [delete (holder as Record<string, unknown>)[name], name in holder]);
  say(label + " put back again", () => (Object.defineProperty(holder, name, original), many()));
}

const timeoutPrototype = Object.getPrototypeOf(timer) as object;
const immediatePrototype = Object.getPrototypeOf(immediate) as object;
all("Timeout.prototype.hasRef", timeoutPrototype, "hasRef", () => hasRefOf(timer), () => loose(timer).hasRef());
all("Timeout.prototype.unref", timeoutPrototype, "unref", () => unrefOf(timer), () => same(loose(timer).unref(), timer));
all("Timeout.prototype.close", timeoutPrototype, "close", () => same(loose(timer).close(), timer), () => same(loose(timer)["close"](), timer));
all("Immediate.prototype.hasRef", immediatePrototype, "hasRef", () => immediateHasRefOf(immediate), () => loose(immediate).hasRef());
console.log(lines.join("\n"));
