// Six Workers and the main thread use the same few hundred names and texts of the program for the first time, all at once: as property names by code that knows nothing of the object, as keys that are
// put together at run time, as constants, as names that reflection hands out. Whatever the run time makes of a name or a text at its first use, every thread has to find it whole, and the same.
import { isMainThread, parentPort, Worker } from "node:worker_threads";

const hide = (v: unknown): any => new CustomEvent("x", { detail: v }).detail;
function record() {
  return {
    alder: 1, birch: 2, cedar: 3, dogwood: 4, elm: 5, fir: 6, ginkgo: 7, hazel: 8, ironwood: 9, juniper: 10, katsura: 11, larch: 12, maple: 13, nutmeg: 14, oak: 15, pine: 16,
    quince: 17, redwood: 18, spruce: 19, tamarack: 20, umbrellaPine: 21, viburnum: 22, walnut: 23, xylosma: 24, yew: 25, zelkova: 26, "a name with spaces": 27, "naïve": 28, "αβγ": 29, "": 30,
  };
}
class Grove { ash = "ash tree"; beech = "beech tree"; chestnut = "chestnut tree"; #hidden = "hidden tree"; static kind = "grove"; get hidden() { return this.#hidden; } [Symbol.toPrimitive]() { return "a grove"; } }
const mark = Symbol("mark"), shared = Symbol.for("shared mark");

function work(): string {
  const out: string[] = [];
  const o = hide(record());
  let sum = 0;
  for (const key of Object.keys(o)) sum += o[key];
  out.push("sum " + sum, Object.keys(o).join("|"));
  // Names put together at run time are the names of the program.
  const parts = [["al", "der"], ["bir", "ch"], ["ce", "dar"], ["umbrella", "Pine"], ["a name", " with spaces"], ["na", "ïve"], ["α", "βγ"], ["", ""], ["no", "such name"]];
  out.push(parts.map(([a, b]) => String(o[hide(a) + hide(b)])).join());
  out.push(o.alder + o.zelkova + o.maple + o.quince + "", String("oak" in o), String("teak" in o), String(Object.hasOwn(o, "pine")), String(o.hasOwnProperty("willow")));
  o.willow = 31; o["sweet" + hide("gum")] = 32; delete o.birch;
  out.push(JSON.stringify(o).length + "", Object.getOwnPropertyNames(o).slice(-3).join());
  const g = hide(new Grove());
  out.push(g.ash, g.beech, g.chestnut, g.hidden, `${g}`, Grove.kind, Grove.name, Object.keys(g).join(), work.name, record.name);
  g[mark] = "marked"; g[shared] = "shared";
  out.push(g[mark], g[Symbol.for("shared mark")], String(mark.description), Object.getOwnPropertySymbols(g).map(s => String(s)).join());
  // Texts as values: compared, looked for, switched on, used as keys of a Map.
  const texts = ["ash tree", "beech tree", "chestnut tree", "hidden tree", "grove", "a grove", "marked", "shared", "never said"];
  const seen = new Map<string, number>();
  for (const t of texts) for (const v of [g.ash, g.beech, g.chestnut, g.hidden, Grove.kind]) if (hide(t) === v) seen.set(t, (seen.get(t) ?? 0) + 1);
  out.push([...seen].join(";"));
  const kinds = texts.map(t => { switch (hide(t)) { case "ash tree": return 1; case "beech tree": return 2; case "grove": return 3; case "marked": return 4; default: return 0; } });
  out.push(kinds.join());
  try { hide(null).alder; } catch (e) { out.push((e as Error).name); }
  try { hide(undefined).zelkova(); } catch (e) { out.push((e as Error).name); }
  return out.join("\n");
}

if (isMainThread) {
  const answers: Promise<string>[] = [];
  for (let i = 0; i < 6; i++) {
    const worker = new Worker(new URL(import.meta.url));
    answers.push(new Promise(resolve => worker.once("message", resolve)));
  }
  const mine = work();
  const theirs = await Promise.all(answers);
  console.log(mine);
  console.log("workers agree", theirs.map(t => t === mine).join());
} else parentPort!.postMessage(work());
