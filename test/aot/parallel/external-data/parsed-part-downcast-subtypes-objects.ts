// A part of parsed JSON is cast from its base type to subtypes whose fields hold objects, arrays and functions. Any object passes where an object type is written. A field written as an array throws at its typed read when it holds no array, a field written as an object type when it holds a number, a number field when it holds a string. A store through the typed reference replaces what did not fit.
interface Base { kind: number }
interface Point { x: number; y: number }
interface Shape extends Base { at: Point; tags: string[]; next: Shape | null }
interface Named extends Base { at: Point; name: string }
interface Watcher extends Base { observe: (value: number) => number }
interface Info { version: string; root: Base; all: Base[] }
function showPoint(point: Point): string { return point ? String(point.x) + "," + String(point.y) : String(point); }
function showShape(shape: Shape): string { return String(shape.kind) + "|" + showPoint(shape.at) + "|" + String(shape.tags && shape.tags.length) + "|" + String(shape.next && shape.next.kind) + "|" + Object.keys(shape).join(","); }
function showNamed(named: Named): string { return String(named.kind) + "|" + showPoint(named.at) + "|" + String(named.name); }
function watch(watcher: Watcher | null): string { return watcher === null ? "none" : typeof watcher.observe === "function" ? String(watcher.observe(2)) : "no observe " + String(watcher.kind); }
function move(shape: Shape): string { shape.at = { x: 9, y: 9 }; shape.tags = ["moved"]; return showShape(shape); }
function makeShape(kind: number): Shape { return { kind, at: { x: kind, y: kind + 1 }, tags: ["a", "b"], next: null }; }
function makeNamed(kind: number): Named { return { kind, at: { x: 0, y: 0 }, name: "n" + kind }; }
function readInfo(text: string): Info { return JSON.parse(text) as Info; }
function attempt(label: string, run: () => string): void {
  try { console.log(label + " " + run()); } catch (error) { console.log(label + " threw " + (error as Error).constructor.name); }
}
const roots: string[] = [
  '{"kind":1,"at":{"x":1,"y":2},"tags":["t"],"next":null}',
  '{"next":null,"tags":["t"],"at":{"y":2,"x":1},"kind":1}',
  '{"kind":1,"at":{"x":1,"y":2},"tags":["t"],"next":{"kind":2,"at":{"x":3,"y":4},"tags":[],"next":null}}',
  '{"kind":1,"at":{"x":1,"y":2},"tags":["t"],"next":{"kind":2}}',
  '{"kind":1}',
  '{"kind":1,"at":null,"tags":null,"next":null}',
  '{"kind":1,"at":{"x":"one"},"tags":"none","next":7}',
  '{"kind":1,"at":{"x":1,"y":2,"z":3},"tags":[1,2,3],"next":null,"name":"both","more":{"deep":true}}',
  '{"kind":1,"at":[1,2],"tags":{"length":5},"next":[]}',
  '{}', '[]',
];
attempt("made", () => showShape(makeShape(1)) + " & " + showNamed(makeNamed(2)));
for (const root of roots) {
  const text = '{"version":"1","root":' + root + ',"all":[' + root + ',' + root + ']}';
  attempt("shape", () => showShape(readInfo(text).root as Shape));
  attempt("both", () => { const held = readInfo(text).root; return showShape(held as Shape) + " & " + showNamed(held as Named) + " & " + showShape(held as Shape); });
  attempt("moved", () => { const held = readInfo(text).root; return move(held as Shape) + " & " + showNamed(held as Named); });
  attempt("field", () => { const holder: { shape: Shape; named: Named } = { shape: readInfo(text).root as Shape, named: makeNamed(3) }; holder.named = holder.shape as Base as Named; return showShape(holder.shape) + " & " + showNamed(holder.named); });
  attempt("all", () => readInfo(text).all.map((base) => showShape(base as Shape)).join(" & "));
  attempt("mixed", () => { const shapes: Shape[] = [makeShape(4), readInfo(text).root as Shape]; shapes[0].next = shapes[1]; return shapes.map(showShape).join(" & "); });
  attempt("watched", () => watch(readInfo(text).root as Watcher));
}
const withAccessor: Base = Object.defineProperty({ kind: 1, tags: ["t"], next: null } as object, "at", { get() { return { x: 5, y: 6 }; }, enumerable: true, configurable: true }) as Base;
attempt("accessor", () => { const info = readInfo('{"version":"1","root":{"kind":0},"all":[]}'); info.root = withAccessor; return showShape(info.root as Shape) + " & " + showNamed(info.root as Named); });
attempt("made again", () => move(makeShape(5)) + " & " + watch(null) + " & " + watch({ kind: 1, observe: (value) => value * 2 }));
