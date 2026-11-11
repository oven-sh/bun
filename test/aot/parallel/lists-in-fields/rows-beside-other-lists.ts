// Rows stored into beside other lists: copied out of a list with holes, of fractions, of texts and objects, out of a view, out of another row, under a mask, and with the other list changed in the turn.
declare const process: { readonly argv: readonly string[] };
export {};
class Board {
    rows: any[][] = [];
    from: any[];
    view = Int16Array.of(5, -6, 7, -8, 9, 10, 11, 12);
    constructor(public wide: number, from: any[]) { this.from = from; for (let y = 0; y < 3; y++) { const row: any[] = []; for (let x = 0; x < wide; x++) row.push(x * (y + 1)); this.rows.push(row); } }
    copy(y: number, to: number) { for (let x = 0; x < to; x++) this.rows[y][x] = this.from[x]; return this; }
    out(y: number, to: number) { for (let x = 0; x < to; x++) this.from[x] = this.rows[y][x]; return this; }
    sum(y: number, to: number) { for (let x = 0; x < to; x++) this.rows[y][x] += this.from[x]; return this; }
    both(y: number, to: number) { const m = this.rows, given = this.from; for (let x = 0; x < to; x++) m[y][x] = given[x] + m[2][x]; return this; }
    views(y: number, to: number) { for (let x = 0; x < to; x++) this.rows[y][x] = this.view[x] * 2; return this; }
    masked(y: number, to: number) { for (let x = 0; x < to; x++) this.rows[y][x & 3] = this.from[x]; return this; }
    self(y: number, to: number) { this.from = this.rows[y]; for (let x = 0; x < to; x++) this.rows[y][x] = this.from[to - 1 - x]; return this; }
    disturbed(y: number, what: number) {
        for (let x = 0; x < this.wide; x++) { this.rows[y][x] = this.from[x]; if (x === 2) this.change(what, y); }
        return this;
    }
    change(what: number, y: number) {
        if (what === 1) this.from = this.rows[y];
        else if (what === 2) this.from.length = 4;
        else if (what === 3) delete this.from[5];
        else if (what === 4) this.from[5] = 0.5;
        else if (what === 5) this.rows[y] = this.from;
        else if (what === 6) this.rows[y].length = 1;
        else if (what === 7) this.from = ["a", "b", "c", "d", "e", "f", "g"];
    }
    tell() { return `${this.rows.map(row => row.map(cell => typeof cell === "object" ? JSON.stringify(cell) : String(cell)).join()).join(" / ")} | ${Object.keys(this.from).map(key => `${key}:${typeof this.from[key as any] === "object" ? "o" : String(this.from[key as any])}`).join()}`; }
}
const wide = process.argv.length + 5, lines: string[] = [];
const lists = (): any[][] => [[9, 8, 7, 6, 5, 4, 3], [9, , 7, , 5, 4, 3], [0.5, 1, 1.5, 2, 2.5, 3, 3.5], ["p", "q", "r", "s", "t", "u", "v"], [{ a: 1 }, null, undefined, 3, 2 ** 31, -0, NaN], [1, 2], []];
for (const list of lists()) {
    const fresh = () => new Board(wide, list.slice());
    for (const to of [0, 3, wide, wide + 2]) lines.push(fresh().copy(1, to).tell(), fresh().out(1, to).tell(), fresh().sum(0, to).tell(), fresh().both(1, to).tell(), fresh().masked(2, to).tell(), fresh().self(1, to).tell());
    lines.push(fresh().views(1, wide).tell());
    for (let what = 0; what < 8; what++) { try { lines.push(`${what} ${fresh().disturbed(1, what).tell()}`); } catch (error) { lines.push((error as Error).name); } }
}
console.log(lines.join("\n"));
