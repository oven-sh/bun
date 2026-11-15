// Lists filled out of rows: of whole numbers, fractions, holes, texts and objects; where the list that is filled is a row, the list of rows itself, or is replaced in the turn.
declare const process: { readonly argv: readonly string[] };
export {};
class Table {
    out: any[] = [0, 0, 0, 0, 0, 0, 0, 0];
    constructor(public rows: any[]) {}
    fill(y: number, to: number) { for (let x = 0; x < to; x++) this.out[x] = this.rows[y][x]; return this; }
    sums(to: number) { for (let x = 0; x < to; x++) this.out[x] = this.rows[0][x] + this.rows[1][x]; return this; }
    least(y: number, to: number) { const out = this.out; for (let x = 0; x < to; x++) if (this.rows[y][x] < out[x]) out[x] = this.rows[y][x]; return this; }
    into(y: number, to: number, out: any[]) { for (let x = 0; x < to; x++) out[x] = this.rows[y][x]; return this; }
    all() { for (let y = 0; y < this.rows.length; y++) for (let x = 0; x < 5; x++) this.out[x] += this.rows[y][x]; return this; }
    changed(y: number, what: number) {
        for (let x = 0; x < 6; x++) {
            this.out[x] = this.rows[y][x];
            if (x === 2) {
                if (what === 1) this.out = this.rows[y];
                else if (what === 2) this.out = this.rows;
                else if (what === 3) this.rows[y] = [7, 7, 7, 7, 7, 7];
                else if (what === 4) this.out[4] = 0.5;
                else if (what === 5) this.out.length = 3;
                else if (what === 6) this.rows = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 0]];
            }
        }
        return this;
    }
    tell() { const told = (list: any[]): string => Object.keys(list).map(key => `${key}:${Array.isArray(list[key as any]) ? `[${list[key as any].length}]` : String(list[key as any])}`).join(); return `${told(this.out)} | ${this.rows.map(row => Array.isArray(row) ? told(row) : String(row)).join(" / ")}`; }
}
const rows = (): any[][] => [[1, 2, 3, 4, 5, 6], [0.5, 1.5, 2.5, 3.5, 4.5, 5.5], [1, , 3, , 5], ["a", "b", "c", "d", "e", "f"], [{}, null, undefined, NaN, -0, 2 ** 40]];
const lines: string[] = [], extra = process.argv.length;
for (let y = 0; y < 5; y++) {
    for (const to of [0, 4, 4 + extra]) lines.push(new Table(rows()).fill(y, to).tell(), new Table(rows()).least(y, to).tell());
    for (let what = 0; what < 7; what++) { try { lines.push(`${what} ${new Table(rows()).changed(y, what).tell()}`); } catch (error) { lines.push((error as Error).name); } }
}
lines.push(new Table(rows()).sums(6).tell(), new Table([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]]).sums(5).all().tell(), new Table(rows()).all().tell());
const own = rows(), shared = new Table(own);
lines.push(shared.into(0, 4, own).tell(), new Table(rows()).into(1, 3, rows()[2]).tell());
try { lines.push(shared.into(0, 4, own[0]).tell()); } catch (error) { lines.push((error as Error).name); }
console.log(lines.join("\n"));
