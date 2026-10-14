// An object with the same property names and kinds as one member of a union arrives from JSON under another type.
declare const console: { log(...values: unknown[]): void };
type Done = { lines: string[] };
type Verdict =
  | { over: Done; halted?: string; text?: string; extra?: readonly string[]; goes?: undefined; cut?: true }
  | { over?: undefined; goes: { text: string; title: string | undefined; extra?: readonly string[] }; cut?: true };
type Run = { blocked?: string; cut?: true };
const goes = (text: string, title: string | undefined, extra?: readonly string[]): Verdict => ({ goes: { text, title, ...(extra !== undefined && extra.length > 0 && { extra }) } });
const never = (): Done => ({ lines: ["never"] });
const settled = (run: Run | undefined, text: string, title: string | undefined, extra?: readonly string[]): Verdict => !run ? { over: never() } : run.blocked ? { over: { lines: [run.blocked] }, halted: run.blocked } : { ...goes(text, title, extra), cut: run.cut };
function read(verdict: Verdict): string { if (verdict.over !== undefined) return "over " + verdict.over.lines.join() + " " + verdict.halted; const text = verdict.goes.text; return text + " " + verdict.goes.title + " " + (verdict.goes.extra ?? []).length + " " + verdict.cut; }
async function chain(run: Run | undefined, text: string): Promise<Verdict> { const verdict = settled(run, text, "title", ["x", "y"]); return verdict; }
async function use(run: Run | undefined, text: string): Promise<string> { let verdict: Verdict; if (text.length > 5) verdict = { goes: { text, title: undefined } }; else verdict = await chain(run, text); return read(verdict); }
const all = async () => console.log(await use({}, "e"), "|", await use({ cut: true }, "f"), "|", await use(undefined, "g"), "|", await use({ blocked: "b" }, "h"), "|", await use({}, "longer text"));
// v4: a record with the same names and kinds comes from JSON under another type.
type Alike = { over?: undefined; goes: { text: string; title: string | undefined }; cut?: true }; const alike = JSON.parse(`{"goes":{"text":"p","title":"q"}}`) as Alike; console.log(alike.goes.text); await all();
