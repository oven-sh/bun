const top = (s, n = 3) =>
  String(s)
    .split("\n")
    .filter(l => l.trimStart().startsWith("at "))
    .slice(0, n)
    .map(l => l.trim().replace(/ ?\(?[^ (]*:\d+:\d+\)?$/, ""))
    .join(" | ");
const unknown = globalThis[process.argv[8] ?? "Object"];
const hidden = unknown.create(null);

function neverWaits(a) {
  return a ? new Error("x").stack : "";
}
function waitsFirst(a) {

  return a ? new Error("x").stack : "";
}
function waitsLast(a) {
  const stack = a ? new Error("x").stack : "";

  return stack;
}
function awaitNeverReached(a) {
  
  return a ? new Error("x").stack : "";
}
const inVariable = function (a) {
  return a ? new Error("x").stack : "";
};
const arrow = a => (a ? new Error("x").stack : "");
const arrowThatWaits = a => {

  return a ? new Error("x").stack : "";
};
const holder = {
  method(a) {
    return a ? new Error("x").stack : "";
  },
  field: function (a) {
    return a ? new Error("x").stack : "";
  },
};
function throwsAtOnce() {
  throw new Error("thrown");
}
async function callsOthers(a) {
  return [await neverWaits(a), await inVariable(a), await arrow(a)].map(s => top(s)).join(" / ");
}
function looked(a) {
  return a ? new Error("x").stack : "";
}
function deleted(a) {
  return a ? new Error("x").stack : "";
}
function both(a) {
  return a ? new Error("x").stack : "";
}
function emptied(a) {
  return a ? new Error("x").stack : "";
}

const all = {
  neverWaits,
  waitsFirst,
  waitsLast,
  awaitNeverReached,
  inVariable,
  arrow,
  arrowThatWaits,
  method: holder.method,
  field: holder.field,
  throwsAtOnce,
  callsOthers,
  looked,
  deleted,
  both,
  emptied,
};
hidden.all = all;

async function show(label) {
  console.log(label, "neverWaits", top(await neverWaits(1)));
  console.log(label, "waitsFirst", top(await waitsFirst(1)));
  console.log(label, "waitsLast", top(await waitsLast(1)));
  console.log(label, "awaitNeverReached", top(await awaitNeverReached(1)));
  console.log(label, "inVariable", top(await inVariable(1)));
  console.log(label, "arrow", top(await arrow(1)));
  console.log(label, "arrowThatWaits", top(await arrowThatWaits(1)));
  console.log(label, "method", top(await holder.method(1)));
  console.log(label, "field", top(await holder.field(1)));
  console.log(label, "throwsAtOnce", top(await (async () => throwsAtOnce())().catch(e => e.stack)));
  console.log(label, "callsOthers", await callsOthers(1));
  console.log(label, "looked", top(await looked(1)));
  console.log(label, "deleted", top(await deleted(1)));
  console.log(label, "both", top(await both(1)));
  console.log(label, "emptied", top(await emptied(1)));
  console.log(label, "not awaited", top(await Promise.resolve(neverWaits(1))), "/", top(await hidden.all.neverWaits(1)));
}

await show("as written:");

let sum = 0;
for (let i = 0; i < 3000; i++) sum += (await neverWaits(0)).length + (await arrow(0)).length + (await holder.method(0)).length;
console.log("warm", sum);

for (const key of unknown.keys(hidden.all)) hidden.all[key].displayName = "shown " + key;
await show("display names:");

console.log(looked.name, unknown.getOwnPropertyNames(looked).join());
delete hidden.all.deleted.displayName;
unknown.defineProperty(hidden.all.both, "name", { value: "named both" });
hidden.all.emptied.displayName = "";
await show("changed:");

for (const key of unknown.keys(hidden.all)) unknown.defineProperty(hidden.all[key], "name", { value: "named " + key });
await show("names:");

unknown.defineProperty(hidden.all.emptied, "name", { value: "" });
console.log("a name without text", top(await emptied(1)));
hidden.all.emptied.displayName = "shown again";
console.log("a name without text", top(await emptied(1)));
delete hidden.all.looked.name;
console.log("no name", looked.name === "", top(await looked(1)));
delete hidden.all.looked.displayName;
console.log("no name", looked.name === "", top(await looked(1)));

for (const key of unknown.keys(hidden.all)) {
  delete hidden.all[key].displayName;
  delete hidden.all[key].name;
}
await show("without either:");

for (let i = 0; i < 3000; i++) {
  if (i === 1500) neverWaits.displayName = "in the middle";
  sum += (await neverWaits(0)).length;
}
console.log("in sight", top(await neverWaits(1)), sum);
