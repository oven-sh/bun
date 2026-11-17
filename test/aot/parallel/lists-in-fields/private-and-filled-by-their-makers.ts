// Lists in private fields, and in fields that the constructor reads before it ends, stored into in loops: in methods, in the constructor itself, behind an object that has no such private name, and with a list laid anew in the turn.
declare const process: { readonly argv: readonly string[] };
export {};
class Inner { list: number[] = []; constructor(n: number) { for (let i = 0; i < n; i++) this.list.push(i); for (let i = 0; i < n; i++) this.list[i] += i & 1; } }
class Keeper {
    #cells: number[] = [];
    #from: any[] = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    inner: Inner;
    constructor(public n: number) { for (let i = 0; i < n; i++) this.#cells.push(i & 3); this.inner = new Inner(n); for (let i = 0; i < n; i++) this.#cells[i] *= 2; }
    store(value: any, to: number) { for (let i = 0; i < to; i++) this.#cells[i] = value; return this; }
    sum(delta: number, from: number, to: number) { for (let i = from; i < to; i++) this.#cells[i] += delta; return this; }
    copy(to: number) { for (let i = 0; i < to; i++) this.#cells[i] = this.#from[i]; return this; }
    swap(to: number) { for (let i = 0; i + 1 < to; i++) { const held = this.#cells[i]; this.#cells[i] = this.#cells[i + 1]; this.#cells[i + 1] = held; } return this; }
    behind(to: number) { for (let i = 0; i < to; i++) this.inner.list[i] += this.#cells[i]; return this; }
    anew(to: number, at: number) { for (let i = 0; i < to; i++) { this.#cells[i] += 1; if (i === at) this.lay(); } return this; }
    lay() { this.#cells = [5, 5, 5, 5, 5, 5, 5, 5]; this.#from = this.#cells; }
    static work(one: any, to: number) { for (let i = 0; i < to; i++) one.#cells[i] = i; }
    tell() { return `${this.#cells.join()} ${this.#from.join()} ${this.inner.list.join()}`; }
}
class Below extends Keeper { more: number[] = []; constructor(n: number) { super(n); for (let i = 0; i < n; i++) this.more[i] = i * 2; this.sum(1, 0, n); } told() { return `${this.tell()} ${this.more.join()}`; } }
const n = process.argv.length + 6, lines: string[] = [];
lines.push(new Keeper(n).store(7, n).tell(), new Keeper(n).store("x", 3).tell(), new Keeper(n).store(0.5, n + 1).tell(), new Keeper(n).sum(2, 1, n).tell(), new Keeper(n).sum(0.25, 0, n + 2).tell());
lines.push(new Keeper(n).copy(n).tell(), new Keeper(n).copy(14).tell(), new Keeper(n).swap(n).tell(), new Keeper(n).behind(n).tell(), new Below(n).told());
for (const at of [-1, 0, 3, 7]) lines.push(new Keeper(n).anew(n, at).copy(4).tell());
for (const one of [new Keeper(n), new Below(n), {}, null, 3, [1]] as any[]) {
    for (const to of [0, 2]) {
        try { Keeper.work(one, to); lines.push(one && one.tell ? one.tell() : String(one)); } catch (error) { lines.push((error as Error).name); }
    }
}
console.log(lines.join("\n"));
