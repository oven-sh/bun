// both counters and both sums are alive
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Row { cells: number[]; bonus: number; constructor(cells: number[], bonus: number) { this.cells = cells; this.bonus = bonus; } }
function total(rows: Row[]): string {
    let all = 0;
    let trace = "";
    for (let r = 0; r < rows.length; r++) {
        let line = 0;
        for (let c = 0; c < 4; c++) {
            const row = rows[(r + c) % rows.length];
            line += row.cells[c] + row.bonus * c;
        }
        all += line * (r + 1);
        trace += line + ",";
    }
    return all + " " + trace;
}
const totalByValue = through(total);
const rows: any[] = [new Row([1, 2, 3, 4], 1), new Row([5, 6, 7, 8], 2), { cells: [9, 10, 11, 12], bonus: 3 }, new Row([13, 14, 15, 16], 4), { cells: { 0: 1, 1: 2, 2: 3, 3: 4 }, bonus: 0.5 }];
console.log(totalByValue(rows), totalByValue(rows.slice(0, 2)), totalByValue(rows.slice(2, 3)));
