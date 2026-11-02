// Options are spread over defaults, or over members that the literal has written, by functions that a table hands out. What they are given is of one of several layouts, so each such spread is one call of a stub.
interface Options { depth: number; width: number; name: string; on: boolean }
interface Some { width?: number; name?: string }
class Settings { depth = 1; width = 2; name = "n"; on = true; }
const defaults: Options = { depth: 3, width: 4, name: "default", on: false };
const whole: any[] = [{ depth: 5, width: 6, name: "given", on: true }, { depth: 7, width: 8, name: "other", on: false }];
const parts: any[] = [{ width: 9, name: "part" }, { width: 10, name: "piece" }];
const instances: any[] = [new Settings(), new Settings()];
if (process.argv.length > 99) { whole[0][process.argv[99]!] = 1; parts[0][process.argv[99]!] = 1; instances[0][process.argv[99]!] = 1; (defaults as any)[process.argv[99]!] = 1; }
const forms: Record<string, (source: any, i: number) => any> = {
  "nothing": source => source,
  "first": source => source.width,
  "second": source => source.name,
  "pair": (source, i) => [source, i],
  "index": (source, i) => i,
  "keys": source => Object.keys(source),
  "text": source => source.name + source.width,
  "label": (source, i) => ({ label: i }),
  "defaults and options": (source): Options => { const options: Options = source; return { ...defaults, ...options }; },
  "defaults and some": (source): Options => { const some: Some = source; return { ...defaults, ...some }; },
  "members and some": (source, i): Options => { const some: Some = source; return { depth: i, width: 0, name: "", on: false, ...some }; },
  "options and a member": (source, i): Options => { const options: Options = source; return { ...options, depth: i }; },
};
const sources: Record<string, any[]> = { whole, parts, instances };
let kept: any = null;
function run(form: string, source: string, rounds: number): number {
  const copy = forms[form]; const list = sources[source]; let sum = 0;
  for (let i = 0; i < rounds; i++) { kept = copy(list[i & 1], i); if (kept) sum++; }
  return sum;
}
const [form, source, rounds] = [process.argv[2] ?? "", process.argv[3] ?? "", Number(process.argv[4] ?? "6")];
const rows: [string, string][] = [["nothing", "whole"], ["defaults and options", "whole"], ["defaults and options", "instances"], ["defaults and some", "parts"], ["members and some", "parts"], ["options and a member", "whole"], ["options and a member", "instances"]];
if (form === "list") for (const [f, s] of rows) console.log(f + "\t" + s);
else if (form) console.log(form, "|", source, run(form, source, rounds), JSON.stringify(kept));
else for (const [f, s] of rows) console.log(f, "|", s, run(f, s, rounds), JSON.stringify(kept));
