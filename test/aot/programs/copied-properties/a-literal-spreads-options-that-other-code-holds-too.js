// Literals that spread options between their own members, where text made at run time holds the options too: which names the new object has, in which order, and what they hold.
const lines = [];
const printed = (key, value) => (typeof value === "function" ? "function " + value.name : value);
const show = (label, value) =>
  lines.push(label + " " + JSON.stringify(value, printed) + " " + Reflect.ownKeys(value).map(String).join());

const held = [];
const hold = new Function("held", "value", "held.push(value); if (held.length > 4) held.shift(); return value;");
const change = new Function(
  "value",
  "step",
  `switch (step % 8) {
    case 1: value.added = step; break;
    case 2: delete value.preload; break;
    case 3: Object.defineProperty(value, "tree", { get() { return "read " + step; }, enumerable: true, configurable: true }); break;
    case 4: Object.defineProperty(value, "restore", { value: "hidden", enumerable: false, configurable: true, writable: true }); break;
    case 5: value[Symbol.for("mark")] = step; break;
    case 6: value.delay = "late"; value.mode = step; break;
    case 7: delete value.tree; value[3] = "three"; value.tree = null; break;
  }`,
);

class Core {
  constructor(options) {
    this.update({
      delay: 50,
      pending: 1000,
      context: undefined,
      ...options,
      strict: options.strict ?? false,
      mode: options.mode ?? "fuzzy",
    });
  }
  update(next) {
    this.options = { ...this.options, ...next };
  }
}

function makeFromLiteral(step) {
  return new Core({ tree: "root " + step, preload: "intent", missing: () => step, restore: true });
}
function makeFromWhatOtherCodeChanged(step) {
  const options = { tree: "root " + step, preload: "intent", missing: () => step, restore: true };
  change(hold(held, options), step);
  return new Core(options);
}
function makeFromText(step) {
  return new Core(JSON.parse(step % 2 ? '{"restore":1,"tree":[2],"strict":true}' : '{"pending":0,"other":{"tree":1}}'));
}

function readByName(options) {
  return [
    options.tree,
    options.preload,
    typeof options.missing === "function" ? options.missing() : options.missing,
    options.restore,
    options.delay,
    options.mode,
    "added" in options,
    Object.hasOwn(options, "preload"),
  ]
    .map(String)
    .join("|");
}

for (let step = 0; step < 24; step++) {
  for (const make of [makeFromLiteral, makeFromWhatOtherCodeChanged, makeFromText]) {
    const core = make(step);
    show(make.name + " " + step, core.options);
    lines.push(readByName(core.options));
    if (step % 5 === 0) {
      core.update({ tree: step, extra: "more" });
      delete core.options.restore;
      core.options.restore = "again";
      show("updated", hold(held, core.options));
    }
  }
}
show(
  "held",
  held.map(value => Object.keys(value).length),
);
console.log(lines.join("\n"));
