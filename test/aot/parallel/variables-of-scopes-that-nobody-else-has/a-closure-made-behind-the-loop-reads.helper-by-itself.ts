interface Row { id: number; name: string; }
function each<T>(list: T[], f: (x: T) => void): void {
    let odd = 0;
    for (let i = 0; i < list.length; i++) f(list[i]);
    for (let i = 0; i < list.length; i++) odd += i & 1;
    if (odd < 0) throw new Error("never");
}
const rows: Row[] = [];
for (let i = 0; i < 12; i++) rows.push({ id: i + 1, name: "row" + i });

function counterFrom(list: Row[]): () => number {
    let sum = 0;
    each(list, row => { sum += row.id; });
    return () => ++sum;
}
function returnsItsOwnArrow(list: Row[]): [(row: Row) => void, () => number] {
    let sum = 0;
    const add = (row: Row) => { sum += row.id; };
    each(list, add);
    return [add, () => sum];
}
const next = counterFrom(rows);
console.log(next(), next(), counterFrom([])());
const [add, read] = returnsItsOwnArrow(rows);
console.log(read());
add(rows[1]);
console.log(read());
