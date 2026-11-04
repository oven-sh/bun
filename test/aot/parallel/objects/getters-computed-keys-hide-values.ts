// An object made by Object.create(defaults) gets getters under names that are computed at run time.
// The same names are stored to other objects and, later, to `defaults` itself.
type Flags = { first?: unknown; second?: unknown; third?: unknown; fourth?: unknown };

const defaults: Record<string, unknown> = { platform: "here", third: "third of defaults" };

function makeGetter(name: string): () => unknown {
  return () => name + " of a getter";
}

function defineGetter(flags: Flags, name: string) {
  Object.defineProperty(flags, name, { get: makeGetter(name), configurable: true, enumerable: true });
}

function makeFlags(names: string[]): Flags {
  const flags: Flags = Object.create(defaults);
  for (const name of names) defineGetter(flags, name);
  return flags;
}

const flags = makeFlags("first,second,third".split(","));

function show(label: string) {
  console.log(label + ":", String(flags.first), "|", String(flags.second), "|", String(flags.third), "|", String(flags.fourth), "|", Object.keys(flags).join());
}

show("made");

// The text is made at run time, so the compiler knows neither what the function does with `defaults` nor what it returns.
const choose = new Function("object", "other", process.argv.length > 99 ? "" : "return other ? {} : object");

const other = choose(defaults, true);
other.first = "first of another object";
other.fourth = "fourth of another object";
show("stored to another object");

const same = choose(defaults, false);
same.first = "first of defaults";
same.fourth = "fourth of defaults";
show("stored to the prototype");

delete flags.first;
show("first deleted");

delete flags.third;
show("third deleted");

defineGetter(flags, ["four", "th"].join(""));
show("fourth defined");

try {
  flags.second = "stored";
  console.log("the store went through");
} catch (error) {
  console.log((error as Error).constructor.name);
}
show("second stored");

delete defaults.first;
delete defaults.third;
show("the prototype gave two names up");

console.log("first" in flags, "second" in flags, Object.hasOwn(flags, "fourth"), Object.hasOwn(flags, "platform"), (flags as any).platform);
