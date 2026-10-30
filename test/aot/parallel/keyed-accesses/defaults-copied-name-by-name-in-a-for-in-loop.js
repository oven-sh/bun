// `for (var name in defaults) options[name] = ..`, as acorn, marked and many others fill their options: the names of the defaults are fields of the copy.
// STATISTIC: FlowAppendedFields >= 4
const defaults = { version: null, locations: false, ranges: false, onToken: null, source: "script" };
function getOptions(given) {
  const options = {};
  for (const name in defaults) options[name] = given && Object.hasOwn(given, name) ? given[name] : defaults[name];
  if (options.version == null) options.version = 11;
  return options;
}
function show(label, object) {
  console.log(label, Object.keys(object).join(), JSON.stringify(object), Reflect.ownKeys(object).length);
}

class Reader {
  constructor(given) {
    this.options = getOptions(given);
    this.position = 0;
  }
  step() {
    if (this.options.locations) this.position += 2;
    if (this.options.ranges) this.position += 3;
    return ++this.position;
  }
}
let sum = 0;
for (const given of [
  undefined,
  {},
  { locations: true },
  { ranges: true, version: 3 },
  { other: 1, source: "module" },
]) {
  const reader = new Reader(given);
  for (let i = 0; i < 100; i++) sum += reader.step();
  show("options", reader.options);
}
console.log(sum);

// The order of the names is the order of the stores, also where a name was stored before the loop.
function reordered() {
  const options = {};
  options.ranges = "first";
  for (const name in defaults) options[name] = defaults[name];
  return options;
}
show("reordered", reordered());

// A name that is deleted and comes again goes to the end.
const again = getOptions();
delete again.locations;
show("deleted", again);
again.locations = 1;
show("again", again);
console.log("locations" in again, Object.hasOwn(again, "ranges"), again.missing);

// The defaults get one name more, lose one, and inherit one: the enumeration shows what is there when it runs.
defaults.added = "late";
delete defaults.onToken;
show("changed defaults", getOptions({ added: 5 }));
Object.setPrototypeOf(defaults, { inherited: "from above" });
show("inherited", getOptions());
Object.defineProperty(defaults, "hidden", { value: 1, enumerable: false });
show("hidden", getOptions());

// The copy may be frozen, be given an accessor, or be a prototype.
const frozen = Object.freeze(getOptions());
try {
  (function () {
    "use strict";
    frozen.locations = true;
  })();
} catch (error) {
  console.log(error.constructor.name);
}
const withAccessor = getOptions();
Object.defineProperty(withAccessor, "ranges", { get: () => "computed", enumerable: true, configurable: true });
show("accessor", withAccessor);
console.log(Object.create(getOptions({ locations: 7 })).locations);

// A target with a setter above it.
function intoHeir() {
  const seen = [];
  const heir = Object.create({
    set locations(value) {
      seen.push(value);
    },
  });
  for (const name in defaults) heir[name] = defaults[name];
  return [Object.keys(heir).join(), seen.join()];
}
console.log(intoHeir().join(" | "));
