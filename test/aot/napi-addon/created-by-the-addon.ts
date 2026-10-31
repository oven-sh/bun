// Objects that the addon creates with napi_create_object() enter types that the program also creates objects of, in the ways a database wrapper hands rows on. The addon itself is `any`.
const loaded: { exports: any } = { exports: {} }; process.dlopen(loaded, process.env.ADDON!); const raw: any = loaded.exports;
interface Row { id: number; name: string; list: number[] }
interface Inner { x: number; tag: string } interface Deep { id: number; inner: Inner }
function row1(): Row { return { id: 9, name: "made by the program", list: [] }; }
function deep1(): Deep { return { id: 9, inner: { x: 9, tag: "p" } }; }
function nameOf(r: Row) { return r.name + r.id + r.list.length; } function tagOf(d: Deep) { return d.inner.tag + d.inner.x + d.id; }
class Statement<T> { get(): T { return raw.makeRow(); } all(): T[] { return raw.makeRows(); } }
function one<T>(): T { return raw.makeRow(); }
function like(): any { return JSON.parse('{"id":1,"name":"n","list":[1,2]}'); }
let at = 0;
function row(label: string, f: () => unknown) { at++; let said: string; try { said = JSON.stringify(f()); } catch (e) { said = "THROWN " + (e as Error).constructor.name + ": " + String((e as Error).message).replace(/ \(bun compile[^)]*\)/, "").replace(/\n */g, " ~ "); } console.log(String(at).padStart(3) + " " + label + ": " + said); }
row("the program's own", () => [nameOf(row1()), tagOf(deep1())]);
row("parsed JSON of the same look, into a variable", () => { const r: Row = like(); return nameOf(r); });
row("into a variable", () => { const r: Row = raw.makeRow(); return nameOf(r); });
row("an argument", () => nameOf(raw.makeRow()));
row("returned", () => { function load(): Row { return raw.makeRow(); } return nameOf(load()); });
row("as Row, then handed on", () => nameOf(raw.makeRow() as Row));
row("a generic function", () => nameOf(one<Row>()));
row("a generic class", () => nameOf(new Statement<Row>().get()));
row("into a member", () => { const holder: { r: Row } = { r: row1() }; holder.r = raw.makeRow(); return nameOf(holder.r); });
row("pushed", () => { const all: Row[] = [row1()]; all.push(raw.makeRow()); return all.map(nameOf); });
row("rows: an element", () => { const all: Deep[] = raw.makeRows(); return tagOf(all[1]); });
row("rows: for of", () => { let s = ""; const all: Deep[] = raw.makeRows(); for (const d of all) s += tagOf(d); return s; });
row("rows: map", () => (raw.makeRows() as Deep[]).map(tagOf));
row("rows: a generic class", () => new Statement<Deep>().all().map(tagOf));
row("rows: the object below", () => { const all: Deep[] = raw.makeRows(); const inner: Inner = all[0].inner; return inner.tag + inner.x; });
row("await", () => "see below");
console.log(await (async () => { try { const r: Row = await Promise.resolve(raw.makeRow()); return "    awaited: " + nameOf(r); } catch (e) { return "    awaited: THROWN " + String((e as Error).message).replace(/ \(bun compile[^)]*\)/, "").replace(/\n */g, " ~ "); } })());
export {};
