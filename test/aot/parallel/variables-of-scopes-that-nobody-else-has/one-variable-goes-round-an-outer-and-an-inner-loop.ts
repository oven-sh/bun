function each<T>(list: T[], f: (x: T) => void): void { for (let i = 0; i < list.length; i++) f(list[i]); }
const tables: number[][] = [];
for (let a = 0; a < 5; a++) {
    const table: number[] = [];
    for (let b = 0; b < a * 2; b++) table.push(a * 10 + b);
    tables.push(table);
}

function written(all: number[][]): string {
    let sum = 0;
    let log = "";
    for (const table of all) {
        each(table, n => { sum += n; });
        log += sum + ",";
        sum = sum / 2;
    }
    return log + sum;
}
function arrowInArrow(all: number[][]): string {
    let sum = 0;
    let rowsSeen = 0;
    each(all, table => {
        let own = 0;
        rowsSeen++;
        each(table, n => { own += n; sum += own; });
        sum -= own * rowsSeen;
    });
    return sum + " " + rowsSeen;
}
console.log(written(tables), arrowInArrow(tables));
console.log(written([]), arrowInArrow([]), written([[]]), arrowInArrow([[], [1]]));
