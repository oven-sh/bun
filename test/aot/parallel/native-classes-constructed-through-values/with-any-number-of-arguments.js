// Native classes held in a table, constructed with any number of arguments, as themselves and for another new.target.
const seen = [];
const show = value => {
  if (value === null || typeof value !== "object" && typeof value !== "function") return typeof value + " " + String(value);
  if (value instanceof Map || value instanceof Set) return value.constructor.name + " " + JSON.stringify([...value]);
  if (value instanceof Error) return value.constructor.name + " " + value.message + " " + String(value.cause) + " " + (value.errors ? value.errors.length : "");
  if (value instanceof Date) return "Date " + value.getTime();
  if (ArrayBuffer.isView(value)) return value.constructor.name + " " + value.length + " " + [...value].join();
  if (value instanceof URL || value instanceof RegExp || value instanceof URLSearchParams) return value.constructor.name + " " + String(value);
  return (value.constructor?.name ?? "none") + " " + (value.byteLength ?? value.size ?? value.status ?? value.length ?? "");
};
const classes = [Map, Set, WeakMap, Error, TypeError, AggregateError, Date, RegExp, Array, ArrayBuffer, Uint8Array, Float64Array, URL, URLSearchParams, Headers, Response, Blob, Object, String, Number, Boolean, Function, Event, AbortController, TextEncoder, Symbol, BigInt, Math.max, (() => {}), parseInt, class Own { constructor(...rest) { this.length = rest.length; } }];
const lists = [[], [5], [[[1, 2], [3, 4]]], ["https://a.example/b", "https://c.example/"], ["text", { status: 201 }], [[1], "message", { cause: 1 }], [2020, 1, 2, 3], [2020, 1, 2, 3, 4], [2020, 1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6, 7, 8, 9]];
function construct(Class, a) {
  switch (a.length) {
    case 0: return new Class();
    case 1: return new Class(a[0]);
    case 2: return new Class(a[0], a[1]);
    case 3: return new Class(a[0], a[1], a[2]);
    case 4: return new Class(a[0], a[1], a[2], a[3]);
    case 5: return new Class(a[0], a[1], a[2], a[3], a[4]);
    case 7: return new Class(a[0], a[1], a[2], a[3], a[4], a[5], a[6]);
    default: return new Class(...a);
  }
}
class Below extends Map { }
for (let round = 0; round < 3; round++) {
  seen.length = 0;
  for (let index = 0; index < classes.length; index++) {
    for (const list of lists) {
      const Class = classes[index];
      if ((Class === Date || Class === String) && list.length === 0) continue;
      try { seen.push(Class.name + " " + show(construct(Class, list))); } catch (error) { seen.push(Class.name + " threw " + error.constructor.name); }
      if (index % 3 === 0) { try { seen.push(Class.name + " for Below " + (Reflect.construct(Class, list, Below) instanceof Below)); } catch (error) { seen.push(Class.name + " for Below threw " + error.constructor.name); } }
    }
  }
}
for (const nothing of [undefined, null, 5, "text", {}]) {
  try { construct(nothing, []); seen.push("constructed"); } catch (error) { seen.push(error.constructor.name + " " + error.message); }
}
let made = 0;
for (let index = 0; index < 5000; index++) { const Class = classes[index % 3 === 0 ? 0 : 1]; made += new Class([[index, 1]]).size; }
seen.push("made " + made);
console.log(seen.join("\n"));
