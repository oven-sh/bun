// Rows of a list that stands in a field, stored into in loops under a row from in front: rows of whole numbers, of fractions, of both, one that overflows, rows shared, replaced, cut and frozen in the turn, and a row that is missing.
declare const process: { readonly argv: readonly string[] };
export {};
class Grid {
    rows: any[][] = [];
    total = 0;
    constructor(public wide: number, high: number, first: number) { for (let y = 0; y < high; y++) { const row: number[] = []; for (let x = 0; x < wide; x++) row.push(first * x + y); this.rows.push(row); } }
    sum(y: number, delta: any, to: number) { for (let x = 0; x < to; x++) this.rows[y][x] += delta; return this; }
    step(y: number, to: number) { for (let x = 0; x < to; x++) this.rows[y][x]++; return this; }
    apart(y: number, delta: any) { for (let x = 0; x < this.rows[y].length; x++) this.rows[y][x] = this.rows[y][x] + delta; return this; }
    choice(y: number, least: any) { for (let x = 0; x < this.wide; x++) if (this.rows[y][x] < least) this.rows[y][x] = least; return this; }
    all(delta: any) { for (let y = 0; y < this.rows.length; y++) for (let x = 0; x < this.wide; x++) this.rows[y][x] -= delta; return this; }
    copy(from: number, to: number) { for (let x = 0; x < this.wide; x++) this.rows[to][x] = this.rows[from][x]; return this; }
    change(what: number, y: number) {
        if (what === 1) this.rows[y] = [100, 101, 102, 103, 104, 105, 106];
        else if (what === 2) this.rows = [[7, 7, 7], [8, 8, 8, 8], [9]];
        else if (what === 3) this.rows[y].length = 2;
        else if (what === 4) Object.freeze(this.rows[y]);
        else if (what === 5) this.rows[0] = this.rows[1] = this.rows[2];
        else if (what === 6) delete this.rows[y];
        else if (what === 7) this.rows[y][4] = this.rows;
        else if (what === 8) (this.rows as any)[y] = Uint8Array.of(250, 251, 252, 253, 254, 255);
        else if (what === 9) (this.rows as any)[y] = "letters";
    }
    disturbed(what: number, y: number, delta: any) {
        try { for (let x = 0; x < this.wide; x++) { if (x === 3) this.change(what, y); this.rows[y][x] += delta; } } catch (error) { this.total += (error as Error).name.length; }
        return this;
    }
    tell() { return `${this.total} ${this.rows.map(row => typeof row === "string" ? row : row && Array.from(row as any, cell => cell === this.rows ? "rows" : String(cell)).join()).join(" / ")}`; }
}
const wide = process.argv.length + 5, lines: string[] = [];
for (const first of [1, 0.5, 2147483640 / 4])
    lines.push(new Grid(wide, 3, first).sum(1, 5, wide).tell(), new Grid(wide, 3, first).sum(0, 0.25, wide + 2).tell(), new Grid(wide, 3, first).sum(2, "x", 2).tell(), new Grid(wide, 3, first).sum(2, undefined, 2).tell(), new Grid(wide, 3, first).step(1, wide).tell(), new Grid(wide, 3, first).apart(0, 3).apart(2, 2147483647).tell(), new Grid(wide, 3, first).choice(1, 3).choice(0, 2.5).tell(), new Grid(wide, 3, first).all(2).tell(), new Grid(wide, 3, first).copy(0, 2).tell());
for (let what = 0; what < 10; what++)
    for (const delta of [1, 0.5, "x", 3n])
        lines.push(`${what} ${new Grid(wide, 3, 1).disturbed(what, 1, delta).tell()}`);
for (const y of [3, -1, 0.5, "1", null] as any[])
    for (const to of [0, 2]) { try { lines.push(new Grid(wide, 3, 1).sum(y, 1, to).tell()); } catch (error) { lines.push((error as Error).name); } }
console.log(lines.join("\n"));
