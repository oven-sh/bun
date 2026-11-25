// An access on an element that is missing throws to the handler around it: a try round the loop, in the loop, round an inner loop, a finally, a generator, an async function, a method, a rethrow.
class Row { constructor(public x: number, public y = x + 1) {} sum(): number { return this.x + this.y; } }
type Rows = (Row | null)[];
type Texts = (string | undefined)[];
const order: string[] = [];
function name(error: unknown): string { return (error as Error).constructor.name; }
function around(rows: Rows): string { let s = 0, i = 0; try { for (; i < rows.length; i++) s += rows[i]!.x; } catch (error) { return name(error) + s + "@" + i; } return "end" + s; }
function inside(rows: Rows): number { let s = 0; for (let i = 0; i < rows.length; i++) { try { s += rows[i]!.sum(); } catch { s += 100; } } return s; }
function nested(rows: Rows): string { let s = 0, i = 0; try { try { while (i < rows.length) { rows[i]!.y += 1; s += rows[i]!.y; i++; } } finally { order.push("f" + i); s += 7; } } catch (error) { return name(error) + s; } return "end" + s; }
function twoLoops(rows: Rows): string { let s = 0; const said: string[] = []; for (let t = 0; t < 2; t++) { try { for (let i = 0; i < rows.length; i++) s += rows[i]!.x * t + 1; said.push("end"); } catch { said.push("c" + t); s += 11; } } return s + said.join(); }
function lengths(texts: Texts): number { let s = 0; for (const text of texts) { try { s += text!.length; } catch { s -= 1; } finally { s += 10; } } return s; }
function again(rows: Rows): string { let s = 0; try { for (const row of rows) { try { s += row!.sum(); } catch (error) { order.push(name(error)); throw new Error("again " + s); } } } catch (error) { return (error as Error).message; } return "end" + s; }
function* steps(rows: Rows): Generator<number, string> { let s = 0; try { for (let i = 0; i < rows.length; i++) { s += rows[i]!.x; yield s; } } catch (error) { return name(error) + s; } finally { order.push("g"); } return "end" + s; }
async function later(rows: Rows): Promise<string> { let s = 0; try { for (let i = 0; i < rows.length; i++) { await 0; s += rows[i]!.y; } } catch (error) { return name(error) + s; } return "end" + s; }
class Reader { total = 0; read(rows: Rows): number { for (let i = 0; i < rows.length; i++) { try { this.total += rows[i]!.x; } catch { this.total += 1000; } } return this.total; } }
function leaves(rows: Rows): number { let s = 0; for (let i = 0; i < rows.length; i++) s += rows[i]!.x; return s; }
function rows(n: number, missing: number): Rows { const made: Rows = []; for (let i = 0; i < n; i++) made.push(i % missing === missing - 1 ? null : new Row(i)); return made; }
function texts(n: number): Texts { const made: Texts = []; for (let i = 0; i < n; i++) made.push(i === 3 ? undefined : "t" + i); return made; }
const reader = new Reader();
for (let t = 0; t < 12; t++) {
  for (const [n, missing] of [[8, 3], [2, 5], [9, 9], [1, 1]] as const) {
    const it = steps(rows(n, missing));
    let step = it.next();
    while (!step.done) step = it.next();
    let left = "";
    try { left = String(leaves(rows(n, missing))); } catch (error) { left = "left " + name(error); }
    const line = [around(rows(n, missing)), inside(rows(n, missing)), nested(rows(n, missing)), twoLoops(rows(n, missing)), lengths(texts(n)), again(rows(n, missing)), step.value, await later(rows(n, missing)), reader.read(rows(n, missing)), left, order.length];
    if (t === 11) console.log(line.join(" "));
  }
}
export {};
