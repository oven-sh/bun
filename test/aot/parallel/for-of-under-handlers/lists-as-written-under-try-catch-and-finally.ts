// Lists as written, stepped by index alone, with a try around the loop, around the nest and between the two loops: the throw goes into the catch, and finally runs.
const log: string[] = []; const say = (x: unknown): void => { log.push(String(x)); };
const run = (f: () => unknown): void => { try { say(f()); } catch (e) { say(e instanceof Error ? e.message : e); } };
const one = [1, 2, 3], two = [[1, 2], [3, 4]];
function lone(stop: number): number { let s = 0; try { for (const a of one) { s += a; if (a === stop) throw s; } } catch (e) { return -(e as number); } return s; }
function around(stop: number): number { let s = 0; try { for (const row of two) for (const b of row) { s += b; if (b === stop) throw s; } } catch (e) { return -(e as number); } return s; }
function between(stop: number): number { let s = 0; for (const row of two) { try { for (const b of row) { s += b; if (b === stop) throw s; } } catch (e) { s = -(e as number); } } return s; }
function lastly(stop: number): string { let s = 0, f = 0; for (const row of two) { try { for (const b of row) { s += b; if (b === stop) throw new Error("out" + s); } } finally { f++; say("f" + f); } } return s + ":" + f; }
function literal(stop: number): number { let s = 0; try { for (const a of [1, 2]) for (const b of [10, 20]) { s += a + b; if (a + b === stop) throw s; } } catch (e) { return -(e as number); } return s; }
for (const f of [lone, around, between, lastly, literal]) for (const stop of [99, 1, 2, 3, 4, 12, 21]) run(() => f(stop));
console.log(log.join(" "));
