// TypeScript infers the element type of Object.values(o) and Object.entries(o) from the properties that the type of `o` names.
// An object may have more properties than its type names, so the arrays hold whatever the object holds.
function tell(name: string, f: () => unknown): void {
  try {
    console.log(name + ": " + JSON.stringify(f()));
  } catch (e) {
    console.log(name + ": " + String(e).split("\n")[0]);
  }
}

const wide = { a: "x", b: 1 };
const narrow: { a: string } = wide;
tell("values of a narrower view", () => Object.values(narrow).map(v => typeof v));
tell("entries of a narrower view", () => Object.entries(narrow).map(([k, v]) => k + " " + typeof v));
function valuesOf(o: { a: string }) {
  return Object.values(o).map(v => typeof v);
}
tell("values, through a parameter", () => valuesOf(wide));
tell("values, in a loop", () => {
  const kinds = [];
  for (const v of Object.values(narrow)) kinds.push(typeof v);
  return kinds;
});
tell("entries, in a loop", () => {
  const kinds = [];
  for (const [k, v] of Object.entries(narrow)) kinds.push(k + " " + typeof v);
  return kinds;
});
tell("values, by index", () => {
  const values = Object.values(narrow);
  return [typeof values[0], typeof values[1], values.length];
});
tell("values that are all of the type", () => Object.values({ a: "x", b: "y" }).map(v => v.toUpperCase()));
tell("entries that are all of the type", () => Object.entries({ a: 1, b: 2 }).map(([k, v]) => k + (v + 1)));

type Body = string | Uint8Array;
const size = (data: Body) => data.length;
const dictionary: Record<string, number> = { n: 1 };
const byNumber: Record<number, Body> = { 1: new Uint8Array(2), 5: "xyz" };
tell("a dictionary is spread first", () => Object.values({ ...dictionary, s: "x" }).map(v => typeof v));
tell("a dictionary is spread last", () => Object.values({ s: "x", ...dictionary }).map(v => typeof v));
tell("entries of a spread dictionary", () => Object.entries({ ...byNumber, 9: "tail" }).map(([number, content]) => [number, size(content)]));
tell("through a const", () => {
  const o = { ...dictionary, s: "x" };
  return Object.values(o).map(v => typeof v);
});
tell("through a function", () => {
  const make = () => ({ ...dictionary, s: "x" });
  return Object.values(make()).map(v => typeof v);
});
tell("the type argument is written", () => Object.values<string | number>({ ...dictionary, s: "x" }).map(v => typeof v));
