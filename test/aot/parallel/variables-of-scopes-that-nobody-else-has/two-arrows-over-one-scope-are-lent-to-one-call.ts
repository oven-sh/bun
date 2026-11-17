interface Row { id: number; name: string; }

function eachBoth<T>(list: T[], f: (x: T) => void, g: (x: T) => void): void {
    for (let i = 0; i < list.length; i++) {
        f(list[i]);
        g(list[i]);
    }
}

const keptByOne: Array<(row: Row) => void> = [];
function eachAndKeepSecond<T>(list: T[], f: (x: T) => void, g: (x: T) => void): void {
    for (let i = 0; i < list.length; i++) f(list[i]);
    keptByOne.push(g as any);
}

function total(rows: Row[], work: number): number {
    let sum = 0;
    let last = -1;
    eachBoth(rows, row => { sum += row.id + (last < 0 ? 0 : 1); }, row => { last = row.id; sum += 1; });
    return sum * 10 + last + work;
}

function totalWithOneKept(rows: Row[], work: number): number {
    let sum = 0;
    eachAndKeepSecond(rows, row => { sum += row.id; }, row => { sum += row.id * 1000; });
    const before = sum;
    keptByOne[keptByOne.length - 1]({ id: 2, name: "late" });
    return sum * 10 + before + work;
}

const world: any = { total, totalWithOneKept };
(globalThis as any).world = world;

const rows: Row[] = [];
for (let i = 0; i < 12; i++) rows.push({ id: i, name: "row" + i });
const alike: any = { length: 3, 0: { id: 5, name: "a" }, 1: { id: 7, name: "b" }, 2: { id: 9, name: "c" } };

let printed = 0;
for (let turn = 0; turn < 40; turn++)
    printed += (globalThis as any).world.total(turn % 4 === 1 ? alike : rows, turn) + (globalThis as any).world.totalWithOneKept(turn % 4 === 2 ? alike : rows, turn);
console.log(printed, keptByOne.length);
console.log(world.total(rows, 1), world.total(alike, 2), world.totalWithOneKept(rows, 3), world.totalWithOneKept(alike, 4));
