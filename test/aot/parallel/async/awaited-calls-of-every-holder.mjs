// Awaited calls of async functions that a binding, a field, a prototype, a function or a class holds, before and after the holder changes.
const log = [];
const say = (...values) => log.push(values.map(show).join(" "));
function show(value) {
  if (value === null || typeof value !== "object") return typeof value === "function" ? "function" : Object.is(value, -0) ? "-0" : String(value);
  return value instanceof Promise ? "promise" : Array.isArray(value) ? `[${value.length}]` : `{${Object.keys(value)}}`;
}
const shared = { count: 0 };
const thenable = value => ({ then(resolve, reject) { say("then is called"); value === 4 ? reject(new TypeError("four")) : resolve(value); } });
async function nothing(value) {}
async function given(value) { return value; }
async function counts(value) { shared.count += value; if (shared.count === 7) throw new RangeError("seven"); return shared; }
async function waits(value) { await null; return value; }
class Tool { async run(value) { return [value]; } static async make(value) { return new Tool(); } async fails(value) { value.missing.member; } }
const api = { nothing, async get(value) { return shared; }, async same(value) { return value; }, async late(value) { await 0; return thenable(value); } };
function Old(value) { this.value = value; }
Old.prototype.get = async function (value) { return this.value + value; };
Old.prototype.nothing = nothing;
function Below(value) { Old.call(this, value); }
Object.setPrototypeOf(Below.prototype, Old.prototype);
Old.find = async value => new Old(value);
Old.each = given;
const holders = { api, Old, tool: new Tool(), old: new Old(1), below: new Below(2) };
const kept = api.same(5);

async function every(i) {
  say("turn", i, await nothing(i), await given(i), await waits(i), await api.nothing(i), (await api.get(i)).count, await api.same(thenable(i)));
  say(await holders.tool.run(i), await Tool.make(i), await holders.old.get(i), await holders.below.get(i), await holders.old.nothing(i), await (await Old.find(i)).get(1), await Old.each(-0), await holders.api.late(i));
  try { say(await counts(i)); } catch (error) { say(error.message); }
  try { await holders.tool.fails(i); } catch (error) { say(error.constructor.name); }
  try { say(await api.same(thenable(4))); } catch (error) { say(error.message); }
  const promise = api.get(i);
  say(promise, await promise === shared, await promise.then(value => value.count));
  return api.nothing(i);
}
const changes = [
  () => { api.same = () => kept; },
  () => { kept.then = function (resolve) { say("own then"); resolve(6); }; },
  () => { kept.constructor = function () {}; },
  () => { Old.prototype.get = () => kept; holders.below.get = async value => value * 2; },
  () => { Old.each = async function (value) { return this === Old; }; delete api.nothing; Object.setPrototypeOf(api, { nothing: value => thenable(value) }); },
  () => { Tool.prototype.run = async value => value; Object.freeze(api); },
];
process.on("unhandledRejection", error => say("unhandled", error.message));
for (let turn = 0; turn < changes.length + 2; turn++) {
  for (let i = 0; i < 3; i++) { try { say(await every(i)); } catch (error) { say("every", error.constructor.name, error.message); } }
  const all = []; for (let i = 0; i < 12; i++) all.push(every(i).then(value => show(value), error => error.constructor.name));
  say((await Promise.all(all)).join());
  changes[turn]?.();
}
console.log(log.length);
console.log(log.join("\n"));
