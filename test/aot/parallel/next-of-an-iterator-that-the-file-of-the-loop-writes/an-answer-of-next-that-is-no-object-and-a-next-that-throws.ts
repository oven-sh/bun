// At one step the function written under `next` answers with a number, or throws. The error, its message and what was summed up to there are as in plain Bun, and the iterator is not closed.
const log: string[] = [];
class Shelf {
  bad: number; how: string;
  constructor(bad: number, how: string) { this.bad = bad; this.how = how; }
  [Symbol.iterator]() { let at = 0; const { bad, how } = this; return { next: (): any => { if (at === bad) { at++; if (how === "throws") throw new RangeError("no step " + bad); return 5; } return at < 6 ? { done: false, value: at++ } : { done: true, value: undefined }; }, return() { log.push("closed"); return { done: true, value: undefined }; } }; }
}
function total(given: Shelf, turns: number): string { let sum = 0; try { for (let turn = 0; turn < turns; turn++) for (const item of given) sum += item; } catch (error) { return sum + " " + String(error); } return String(sum); }
(globalThis as any).keep = [total, new Shelf(-1, "")];
const bad = Number(process.argv[2] ?? 3);
console.log(total(new Shelf(-1, ""), 4), "|", total(new Shelf(bad, "number"), 4), "|", total(new Shelf(bad, "throws"), 4), "|", total(new Shelf(0, "number"), 4), "|", log.join(","));
