// Lists that stand in fields, read in loops that store into others: a view, a list of doubles, one behind another field, one that a turn replaces or shortens, one that is the list stored into.
declare const process: { readonly argv: readonly string[] };
export {};
class Inner { values: number[] = []; constructor(n: number) { for (let i = 0; i < n; i++) this.values.push(i * 2); } }
class Frame {
    from: number[] = [];
    out: any[] = [];
    halves: number[] = [];
    view: Int16Array;
    inner: Inner;
    constructor(public n: number) { for (let i = 0; i < n; i++) { this.from.push(i % 5); this.out.push(0); this.halves.push(i / 2); } this.view = new Int16Array(n); this.inner = new Inner(n); }
    copy(to: number) { for (let i = 0; i < to; i++) this.out[i] = this.from[i]; return this; }
    behind(to: number) { for (let i = 0; i < to; i++) this.out[i] = this.inner.values[i] + this.halves[i]; return this; }
    views(to: number) { for (let i = 0; i < to; i++) this.view[i] = this.halves[i] * 3; for (let i = 0; i < to; i++) this.out[i] = this.view[i]; return this; }
    under(to: number) { for (let i = 0; i < to; i++) this.out[this.from[i]] = i; return this; }
    shift(to: number) { for (let i = 0; i + 1 < to; i++) this.from[i] = this.from[i + 1]; return this; }
    replaced(what: number, to: number) {
        try { for (let i = 0; i < to; i++) { this.out[i] = this.from[i]; if (i === 2) this.change(what); } } catch (error) { lines.push((error as Error).name); }
        return this;
    }
    change(what: number) {
        if (what === 1) this.from = [10, 11, 12, 13, 14, 15, 16, 17];
        else if (what === 2) this.from.length = 4;
        else if (what === 3) this.out = [];
        else if (what === 4) (this as any).from = "abcdefgh";
        else if (what === 5) (this as any).from = null;
        else if (what === 6) this.from = this.out;
        else if (what === 7) delete this.from[5];
        else if (what === 8) Object.freeze(this.out);
        else if (what === 9) this.from[6] = 0.25;
    }
    tell() { return `${this.from && Array.from(this.from as any).join()} ${this.out.join()} ${this.view.join()}`; }
}
const n = process.argv.length + 8, lines: string[] = [];
lines.push(new Frame(n).copy(n).tell(), new Frame(n).copy(n + 2).tell(), new Frame(n).copy(0).tell(), new Frame(n).behind(n).tell(), new Frame(n).behind(n + 1).tell(), new Frame(n).views(n).tell(), new Frame(n).under(n).tell(), new Frame(n).shift(n).shift(n).tell());
for (let what = 0; what < 10; what++)
    lines.push(`${what} ${new Frame(n).replaced(what, 8).tell()} | ${new Frame(n).replaced(what, 2).tell()}`);
console.log(lines.join("\n"));
