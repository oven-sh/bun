// `{ ...source, ...more }` under a written type, where `more` is parsed JSON and the object that is copied was created as a narrower type than the one the copy is written as: the copy takes whatever its own written type takes.
const row = (name: string, f: () => unknown) => { let r: unknown; try { r = JSON.stringify(f()); } catch (e) { r = "THROWS " + (e as Error).message.split(" (bun")[0]; } console.log(name + ": " + r); };

type Failures = { last: number | null; count: number; name: string };
type Fresh = { last: null; count: number; name: string };
type FreshAndMore = { last: null; count: number; name: string; extra: boolean };
type Counts = { last: number; count: number };

const fresh: Fresh = { last: null, count: 0, name: "fresh" };
const freshAndMore: FreshAndMore = { last: null, count: 0, name: "more", extra: true };
const wide: Failures = { last: null, count: 0, name: "wide" };
const constant = { last: null, count: 0, name: "constant" } as const;

function merge(failures: Failures, counts: Counts): Failures {
  if (failures.last === null) return { ...failures, ...counts };
  return failures;
}
function mergeInsideTry(failures: Failures, counts: Counts): Failures {
  try {
    return { ...failures, ...counts };
  } catch {
    return failures;
  }
}
function mergeAndName(failures: Failures, counts: Counts): Failures {
  return { ...failures, ...counts, name: "named" };
}
const parsed = (text: string) => JSON.parse(text) as Counts;

const sources: [string, Failures][] = [["a narrower written type", fresh], ["a narrower type with one member more", freshAndMore], ["the written type itself", wide], ["an `as const` literal", constant]];
for (const [name, source] of sources) {
  row(name + ": a second spread of parsed JSON", () => merge(source, parsed('{"last":9,"count":2}')));
  row(name + ": inside try", () => mergeInsideTry(source, parsed('{"last":10,"count":3}')));
  row(name + ": with a member behind it", () => mergeAndName(source, parsed('{"last":11,"count":4}')));
  row(name + ": the keys of the copy", () => Object.keys(merge(source, parsed('{"count":5,"last":12}'))));
  row(name + ": the copy is read", () => { const copy = merge(source, parsed('{"last":13,"count":6}')); return copy.last! + copy.count; });
  row(name + ": the source is left as it was", () => source);
}
let sum = 0;
for (let i = 0; i < 5000; i++) {
  const source = i % 3 === 0 ? fresh : i % 3 === 1 ? wide : freshAndMore;
  sum += merge(source, parsed('{"last":' + i + ',"count":1}')).last!;
}
row("many times, the types taking turns", () => sum);
