interface Row { id: number; name: string; }
const rows: Row[] = [];
for (let i = 0; i < 12; i++) rows.push({ id: i + 1, name: "row" + i });

function throughForEach(list: Row[]): number { let sum = 0; list.forEach(row => { sum += row.id; }); return sum + 1; }
function throughMap(list: Row[]): string { let sum = 0; const made = list.map(row => { sum += row.id; return sum; }); return made.join() + " " + sum; }
function throughSome(list: Row[]): string { let turns = 0; const found = list.some(row => { turns++; return row.id === 5; }); return found + " " + turns; }
function throughReduce(list: Row[]): string { let turns = 0; const all = list.reduce((held, row) => { turns += 2; return held + row.id * turns; }, 0); return all + " " + turns; }
function throughFilter(list: Row[]): string { let kept = 0; const made = list.filter(row => { if (row.id % 3) return false; kept += row.id; return true; }); return made.length + " " + kept; }
function throughSort(list: Row[]): string { let asked = 0; const sorted = list.slice().sort((a, b) => { asked++; return b.id - a.id; }); return sorted[0].name + " " + (asked > 0); }
function listChangesInTheTurn(list: Row[]): string {
    const own = list.slice();
    let sum = 0;
    own.forEach(row => { sum += row.id; if (row.id === 3) own.length = 6; if (row.id === 5) own[5] = { id: 0.5, name: "put in" }; });
    return sum + " " + own.length;
}
function holes(): string { let sum = 0; let turns = 0; const list = [1, , 3, , 5] as number[]; list.forEach(n => { turns++; sum += n; }); return sum + " " + turns; }
console.log(throughForEach(rows), throughMap(rows), throughSome(rows), throughReduce(rows), throughFilter(rows), throughSort(rows), listChangesInTheTurn(rows), holes());
console.log(throughForEach([]), throughMap([]), throughSome([]), throughReduce([]), throughFilter([]), listChangesInTheTurn([]));
