// Objects that the addon creates with napi_create_object(), wrapped, tagged and referenced by the addon while typed code uses them under a declared type.
const loaded: { exports: any } = { exports: {} }; process.dlopen(loaded, process.env.ADDON!); const raw: any = loaded.exports;
interface Row { id: number; name: string; list: number[] }
function row1(): Row { return { id: 9, name: "made by the program", list: [] }; }
function nameOf(r: Row) { return r.name + r.id + r.list.length; } function rename(r: Row, to: string) { r.name = to; r.id++; }
let at = 0;
function row(label: string, f: () => unknown) { at++; let said: string; try { said = JSON.stringify(f()); } catch (e) { said = "THROWN " + (e as Error).constructor.name + ": " + String((e as Error).message).replace(/ \(bun compile[^)]*\)/, "").replace(/\n */g, " ~ "); } console.log(String(at).padStart(3) + " " + label + ": " + said); }
row("the program's own", () => nameOf(row1()));
row("what it is", () => { const r = raw.makeRow(); return [raw.typeOf(r), raw.kinds(r), Object.getPrototypeOf(r) === Object.prototype, Object.prototype.toString.call(r), r.constructor === Object, Bun.inspect(r), Bun.deepEquals(r, { id: 1, name: "n", list: [1, 2] }, true), require("util").isDeepStrictEqual(r, { id: 1, name: "n", list: [1, 2] })]; });
row("wrap | unwrap | removeWrap", () => { const r = raw.makeRow(); return [raw.wrap(r, 42), raw.unwrap(r), raw.names(r), Object.keys(r), Reflect.ownKeys(r).length, JSON.stringify(r), raw.allNames(r, 1, 0, 0), raw.wrap(r, 43), raw.removeWrap(r), raw.unwrap(r), raw.wrap(r, 44), raw.unwrap(r), Object.keys(r)]; });
row("wrapped, then cloned | spread | assigned", () => { const r = raw.makeRow(); raw.wrap(r, 1); return [structuredClone(r), raw.unwrap({ ...r }), raw.unwrap(Object.assign({}, r)), raw.unwrap(structuredClone(r))]; });
row("tag | checkTag", () => { const r = raw.makeRow(); return [raw.checkTag(r, 1), raw.tag(r, 1), raw.checkTag(r, 1), raw.checkTag(r, 2), raw.tag(r, 2), Object.keys(r)]; });
row("frozen by the addon", () => { const r = raw.makeRow(); return [raw.freeze(r), Object.isFrozen(r), raw.setNamed(r, "id", 5), r.id]; });
row("wrapped, then used as a Row", () => { const r = raw.makeRow(); raw.wrap(r, 42); const typed: Row = r; rename(typed, "typed"); return [nameOf(typed), raw.unwrap(typed), raw.unwrap(r), typed === r, raw.names(typed)]; });
row("tagged, then used as a Row", () => { const r = raw.makeRow(); raw.tag(r, 1); const typed: Row = r; rename(typed, "typed"); return [raw.checkTag(typed, 1), raw.checkTag(r, 1)]; });
row("held by the addon, then used as a Row", () => { const r = raw.makeRow(); raw.keep(r); const typed: Row = r; rename(typed, "typed"); const back = raw.keptValue(); return [back === typed, back === r, raw.getNamed(back, "name"), raw.getNamed(back, "id"), raw.setNamed(back, "name", "by the addon"), nameOf(typed), raw.dropKept()]; });
row("used as a Row, then filled by the addon", () => { const typed: Row = raw.makeRow(); return [raw.fill(typed) === typed, nameOf(typed)]; });
row("used as a Row, then wrapped", () => { const typed: Row = raw.makeRow(); return [raw.wrap(typed, 7), raw.unwrap(typed), nameOf(typed), Object.keys(typed)]; });
{
  const before = raw.finalizedSoFar();
  let said: string;
  try { for (let i = 0; i < 2000; i++) { const typed: Row = raw.makeRow(); raw.wrap(typed, i); nameOf(typed); } Bun.gc(true); await new Promise(resolve => setTimeout(resolve, 20)); Bun.gc(true); await new Promise(resolve => setTimeout(resolve, 20)); said = String(raw.finalizedSoFar() - before > 0); } catch (e) { said = "THROWN " + String((e as Error).message).replace(/ \(bun compile[^)]*\)/, "").replace(/\n */g, " ~ "); }
  console.log("    finalizers of what the addon made run: " + said);
}
export {};
