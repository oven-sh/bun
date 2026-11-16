// Lists that stand in fields, stored into in loops: in classes, functions, behind another field and off a parameter; with turns that lay another list, shrink or freeze the one there, or leave a hole.
declare const process: { readonly argv: readonly string[] };
export {};
class Inner { list: number[] = []; constructor(n: number) { for (let i = 0; i < n; i++) this.list.push(i & 3); } }
class Tree {
    list: number[] = [];
    total = 0;
    inner: Inner;
    constructor(public size: number) { for (let i = 0; i <= size; i++) this.list.push(i & 3); this.inner = new Inner(size); }
    sums(delta: number, from: number, to: number) { for (let i = from; i < to; i++) this.list[i] += delta; return this; }
    bits(index: number, delta: number) { this.total += delta; for (let i = index + 1; i <= this.size; i += i & -i) this.list[i] += delta; return this; }
    least(limit: number) { for (let i = 0; i < this.list.length; i++) if (this.list[i] < limit) this.list[i] = limit; return this; }
    behind(delta: number, to: number) { for (let i = 0; i < to; i++) this.inner.list[i] = this.list[i] + delta; return this; }
    other(tree: Tree, to: number) { for (let i = to - 1; i >= 0; i--) tree.list[i] = this.list[i] - i; return this; }
    swap(to: number) { for (let i = 0; i + 1 < to; i++) { const held = this.list[i]; this.list[i] = this.list[i + 1]; this.list[i + 1] = held; } return this; }
    disturbed(what: number, delta: any, to: number) {
        try {
            for (let i = 0; i < to; i++) {
                if (i === 3) this.disturb(what);
                this.list[i] += delta;
            }
        } catch (error) { this.total += (error as Error).name.length; }
        return this;
    }
    disturb(what: number) {
        if (what === 1) this.list = [9, 8, 7, 6, 5, 4, 3, 2, 1];
        else if (what === 2) this.list.length = 5;
        else if (what === 3) Object.freeze(this.list);
        else if (what === 4) delete this.list[6];
        else if (what === 5) this.list.push(1, 2, 3);
        else if (what === 6) (this as any).list = Uint8Array.from(this.list);
        else if (what === 7) (this as any).list = undefined;
        else if (what === 8) Object.defineProperty(this, "list", { value: [1, 2, 3, 4, 5, 6, 7, 8], writable: false, configurable: true });
    }
    tell() { return `${this.total} ${this.list ? Array.from(this.list, value => typeof value === "bigint" ? `${value}n` : String(value)).join() : this.list} ${this.inner.list.join()}`; }
}
function Old(this: any, n: number) { this.n = n; this.cells = []; for (let i = 0; i < n; i++) this.cells.push(0); }
(Old as any).prototype.mark = function (this: any, from: any, value: any) { for (let i = from; i < this.n; i++) this.cells[i] = value; return this; };
const size = process.argv.length + 8, lines: string[] = [];
lines.push(new Tree(size).sums(5, 0, size).bits(0, 3).bits(4, 2).least(4).behind(1, size).swap(size).tell());
lines.push(new Tree(size).sums(0.5, 1, size + 3).tell(), new Tree(size).sums(2147483647, 0, 4).sums(2147483647, 0, 4).tell(), new Tree(size).sums(1, size, 0).tell());
const one = new Tree(size), two = new Tree(size);
lines.push(one.other(two, size).tell(), two.other(one, size).tell(), one.other(one, 5).tell());
for (let what = 0; what < 9; what++)
    for (const delta of [1, 1.5, "x", 2n, undefined])
        lines.push(`${what} ${new Tree(size).disturbed(what, delta, 9).tell()}`);
for (const from of [0, 2, 1.5, -1, undefined, "3", 40])
    lines.push(Object.entries(new (Old as any)(6).mark(from, 7).cells).join(" "));
console.log(lines.join("\n"));
