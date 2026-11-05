// The name that a stack trace and a call site show for a function: as it is written, behind Object.defineProperty(f, "name", ..), behind `delete f.name`,
// and behind a second definition.
import named from "./named.mjs";

const frame = () =>
  new Error("here").stack
    .split("\n")[2]
    .trim()
    .replace(/\(.*[\/\\]/, "(");
function callSite() {
  const prepare = Error.prepareStackTrace;
  Error.prepareStackTrace = (_error, sites) => String(sites[1].getFunctionName());
  const name = new Error("here").stack;
  Error.prepareStackTrace = prepare;
  return name;
}
function local() {
  return [frame(), callSite()].join(" ");
}
const expression = function () {
  return [frame(), callSite()].join(" ");
};
const arrow = () => [frame(), callSite()].join(" ");
const holder = {
  method() {
    return [frame(), callSite()].join(" ");
  },
};
function make() {
  return function made() {
    return [frame(), callSite()].join(" ");
  };
}
async function waits() {
  return [frame(), callSite()].join(" ");
}
function* steps() {
  yield [frame(), callSite()].join(" ");
}

for (const f of [named, local, expression, arrow, holder.method, make()]) {
  const rows = [f()];
  Object.defineProperty(f, "name", { value: "renamed" });
  rows.push(f());
  console.log(delete f.name, Object.hasOwn(f, "name"), JSON.stringify(f.name));
  rows.push(f());
  Object.defineProperty(f, "name", { value: "again", configurable: true });
  rows.push(f());
  delete f.name;
  rows.push(f());
  console.log(rows.join(" | "));
}

const rows = [await waits()];
Object.defineProperty(waits, "name", { value: "renamed" });
rows.push(await waits());
delete waits.name;
rows.push(await waits());
console.log(rows.join(" | "));

const stepped = [steps().next().value];
Object.defineProperty(steps, "name", { value: "renamed" });
stepped.push(steps().next().value);
delete steps.name;
stepped.push(steps().next().value);
console.log(stepped.join(" | "));

function kept() {
  return [frame(), callSite()].join(" ");
}
Object.defineProperty(kept, "name", { value: "fixed", configurable: false });
try {
  delete kept.name;
} catch (error) {
  console.log(error.constructor.name);
}
console.log(kept());
