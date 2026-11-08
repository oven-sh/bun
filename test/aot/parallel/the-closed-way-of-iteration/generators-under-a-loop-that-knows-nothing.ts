const log: string[] = [];
function* counts(limit: number): Generator<number> { try { for (let i = 0; i < limit; i++) yield i; } finally { log.push("finally"); } }
let running: any;
function* entersItself(): Generator<number> { yield 1; for (const inner of running) yield inner as number; }
(globalThis as any).shelf = { counts, entersItself };
const shelf: any = (globalThis as any).shelf;
function upTo(items: any, stop: number): string { let text = ""; for (const item of items) { if (item === stop) break; text += item + ";"; } return text; }
function throwsAt(items: any, bad: number): string { try { for (const item of items) if (item === bad) throw new RangeError("at " + item); return "end"; } catch (error) { return (error as Error).message; } }
function again(): string { try { running = shelf.entersItself(); let text = ""; for (const item of running) text += item + ";"; return text; } catch (error) { return (error as Error).constructor.name; } }
let out = ""; for (let round = 0; round < 3; round++) { out += upTo(shelf.counts(5), 3) + log.join() + "|" + upTo(shelf.counts(2), 9) + log.join() + "|" + throwsAt(shelf.counts(4), 2) + log.join() + "|" + again() + "\n"; log.length = 0; } console.log(out);
