interface Row { id: number; name: string; }

function each<T>(list: T[], f: (x: T) => void): void { for (let i = 0; i < list.length; i++) f(list[i]); }

function total(rows: Row[], work: number): number {
    let sum = 0;
    let count = 0;
    let longest = "";
    each(rows, row => {
        sum += row.id;
        count++;
        if (row.name.length > longest.length) longest = row.name;
    });
    return sum * 100 + count * 10 + longest.length + work;
}

function totalTwice(rows: Row[], others: Row[], work: number): number {
    let sum = work;
    each(rows, row => { sum += row.id; });
    const between = sum;
    each(others, row => { sum = sum * 2 + row.id; });
    return sum - between + work;
}

const world: any = { total, totalTwice };
(globalThis as any).world = world;

const rows: Row[] = [];
for (let i = 0; i < 12; i++) rows.push({ id: i, name: "row" + i });
const alike: any = { length: 3, 0: { id: 5, name: "a" }, 1: { id: 7, name: "bcd" }, 2: { id: 9, name: "ef" } };

let printed = 0;
for (let turn = 0; turn < 40; turn++)
    printed += (globalThis as any).world.total(turn % 4 === 3 ? alike : rows, turn);
console.log(printed);
console.log(world.total(rows, 1), world.total(alike, 2), world.total([], 3), world.total({ length: 0 }, 4));
console.log(world.totalTwice(rows, alike, 1), world.totalTwice(alike, rows, 2), world.totalTwice(alike, alike, 3), world.totalTwice(rows, rows, 4));
