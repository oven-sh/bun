// Fields that hold an arrow function in one object and undefined or null in another: given by literals, by constant literals, by stores, by name, by spreads and by classes.
const lines: string[] = [];
function say(...values: unknown[]) {
  lines.push(values.map(String).join(" "));
}
function attempt(action: () => unknown) {
  try {
    return String(action());
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

type Hooks = {
  name: string;
  onStart: (() => string) | undefined;
  onData: ((chunk: string) => string) | null;
  onEnd?: () => string;
  onError: (() => string) | undefined | null;
};

// Nothing but constants.
const none: Hooks = { name: "none", onStart: undefined, onData: null, onError: null };
function full(name: string): Hooks {
  const hooks: Hooks = {
    name,
    onStart: () => "start " + hooks.name,
    onData: chunk => chunk + " for " + hooks.name,
    onEnd: () => "end",
    onError: () => "error",
  };
  return hooks;
}
function partial(name: string, n: number): Hooks {
  return {
    name,
    onStart: n & 1 ? () => "start" : undefined,
    onData: n & 2 ? chunk => chunk + "!" : null,
    onError: n & 4 ? () => "error" : n & 8 ? null : undefined,
  };
}
function describe(hooks: Hooks) {
  return [
    hooks.name,
    hooks.onStart?.(),
    hooks.onData?.("d") ?? "no data",
    hooks.onEnd ? hooks.onEnd() : "no end",
    hooks.onError === null ? "null" : hooks.onError === undefined ? "undefined" : hooks.onError(),
    typeof hooks.onStart,
    typeof hooks.onData,
    typeof hooks.onEnd,
    "onEnd" in hooks,
    Object.keys(hooks).join("+"),
  ].join(" | ");
}

say(describe(none));
say(describe(full("a")));
for (let n = 0; n < 16; n += 3) say(describe(partial("p" + n, n)));

// Stores that replace a closure that was never made, and one that was.
const replaced = full("replaced");
replaced.onStart = undefined;
replaced.onData = null;
const madeEnd = replaced.onEnd;
replaced.onEnd = undefined;
replaced.onError = null;
say(describe(replaced), madeEnd?.());
replaced.onStart = () => "again " + replaced.name;
replaced.onData = chunk => chunk + " again";
replaced.onError = undefined;
say(describe(replaced));

// By a name that the compiler cannot see.
const names = ["onStart", "onData", "onEnd", "onError"] as const;
const byName = full("by name");
const loose = byName as unknown as Record<string, unknown>;
for (const name of names) {
  loose[name] = names.indexOf(name) % 2 ? null : undefined;
}
say(describe(byName), JSON.stringify(byName));
for (const name of names) loose[name] = () => "stored by name " + name;
say(describe(byName));
for (const name of names) say(name, delete loose[name], name in loose, loose[name]);
say(describe(byName));

// Copies.
const copyOfNone = { ...none };
const copyOfFull = { ...full("copied"), onStart: undefined };
const merged: Hooks = Object.assign(full("merged"), none, { name: "merged again" });
say(describe(copyOfNone));
say(describe(copyOfFull));
say(describe(merged));
const overNone: Hooks = { ...none, ...full("over none") };
say(describe(overNone), overNone.onStart === overNone.onStart);

// Identity and truthiness around the values.
const many: Hooks[] = [];
for (let i = 0; i < 40; i++) many.push(i % 4 === 0 ? none : i % 4 === 1 ? full("f" + i) : partial("p" + i, i));
let started = 0;
let data = 0;
let errors = 0;
for (const hooks of many) {
  if (hooks.onStart) started++;
  if (hooks.onData !== null) data++;
  if (hooks.onError == null) errors++;
}
say("counts", started, data, errors, many[1].onStart === many[1].onStart, many[1].onStart !== many[5].onStart, many[0].onStart === many[4].onStart);

// Classes: a field that starts as undefined or null and gets its arrow later, or the other way round.
class Task {
  done: (() => string) | undefined = undefined;
  failed: (() => string) | null = null;
  always = () => "always " + this.label;
  constructor(public label: string) {}
  arm() {
    this.done = () => "done " + this.label;
    this.failed = () => "failed " + this.label;
    return this;
  }
  disarm() {
    this.done = undefined;
    this.failed = null;
    (this as { always: unknown }).always = undefined;
    return this;
  }
}
function report(task: Task) {
  return [task.label, task.done?.(), task.failed?.(), attempt(() => task.always()), Object.keys(task).join("+")].join(" | ");
}
say(report(new Task("fresh")));
say(report(new Task("armed").arm()));
say(report(new Task("disarmed").arm().disarm()));
say(report(new Task("armed again").arm().disarm().arm()));
const frozenTask = Object.freeze(new Task("frozen"));
say(attempt(() => frozenTask.arm()), report(frozenTask));

console.log(lines.join("\n"));
