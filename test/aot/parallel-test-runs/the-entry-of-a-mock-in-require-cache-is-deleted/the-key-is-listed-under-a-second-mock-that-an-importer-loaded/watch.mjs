// One printer for every cell on mocks: at every step it says every observable that costs no load:
// how often each body ran, how often each factory was called, what require.cache says of each key, and of every object of the mocked file that the cell has ever held: which object it is, its keys, what it reads now;
// of each importer what its LATEST instance sees. How often an importer ran and what its earlier instances see stand on a line of their own: a compiled importer is not run again, and that must not hide the rest.
const state = (globalThis.watched ??= { objects: [], names: [], importers: [], namesOfImporters: [], latest: {}, keys: [], calls: {}, ran: {} });
state.importers ??= []; state.namesOfImporters ??= []; state.latest ??= {};
export const made = (name, exports) => () => { state.calls[name] = (state.calls[name] ?? 0) + 1; return typeof exports === "function" ? exports(state.calls[name]) : exports; };
export const watchKey = key => { if (!state.keys.includes(key)) state.keys.push(key); return key; };
const numberIn = (list, object) => { let at = list.indexOf(object); if (at < 0) at = list.push(object) - 1; return at; };
const number = object => "#" + (numberIn(state.objects, object) + 1);
const safe = read => { try { return read(); } catch (error) { return "threw " + String(error?.message).slice(0, 40); } };
export const tried = async read => { try { return await read(); } catch (error) { return "threw " + String(error?.message).slice(0, 40); } };
const isOfImporter = name => /^(user|late|other)/.test(name ?? "");
export const hold = (name, value) => {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) { if (isOfImporter(name)) state.latest[name] = String(value); return String(value); }
  if (isOfImporter(name)) { state.namesOfImporters[numberIn(state.importers, value)] ??= name; state.latest[name] = value; return ""; }
  const at = number(value); state.names[Number(at.slice(1)) - 1] ??= name; return at;
};
const short = key => key.slice(key.lastIndexOf("/") + 1);
const listedInLoop = key => { let seen = false; for (const each in require.cache) seen ||= each === key; return seen; };
const bit = value => (value ? "1" : "0");
const cache = key => short(key) + " " + [key in require.cache, Object.keys(require.cache).includes(key), Reflect.ownKeys(require.cache).includes(key), Object.hasOwn(require.cache, key), listedInLoop(key), Object.getOwnPropertyDescriptor(require.cache, key) !== undefined].map(bit).join("") + " " + typeof require.cache[key];
const reading = object => {
  if (typeof object === "string") return object;
  const parts = [safe(() => Object.keys(object).join("+"))];
  for (const name of ["x", "o"]) if (safe(() => name in object) === true) parts.push(name + "=" + safe(() => String(object[name])));
  if (typeof safe(() => object.seen) === "function") parts.push("seen=" + safe(() => String(object.seen())));
  if (typeof safe(() => object.whole) === "function") parts.push("whole=" + safe(() => number(object.whole())));
  return parts.join(" ");
};
export const look = step => {
  const own = (table, wanted) => JSON.stringify(Object.fromEntries(Object.entries(table).filter(([name]) => isOfImporter(name) === wanted).sort()));
  console.log("SAID", step, "| ran", own(state.ran, false), "calls", JSON.stringify(state.calls), "| cache", state.keys.map(cache).join(" , "));
  console.log("SAID", step, "| now", Object.entries(state.latest).sort().map(([name, object]) => name + ": " + reading(object)).join(" ; "));
  console.log("SAID", step, "| held", state.objects.map((object, at) => "#" + (at + 1) + ": " + reading(object)).join(" ; "));
  console.log("SAID97", step, "| ran", own(state.ran, true), "|", state.importers.map((object, at) => state.namesOfImporters[at] + (at + 1) + ": " + reading(object)).join(" ; "));
};
