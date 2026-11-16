interface Row { id: number; name: string; }

function backwards<T>(list: T[], f: (x: T) => void): void { for (let i = list.length - 1; i >= 0; i--) f(list[i]); }

function each<T>(list: T[], f: (x: T) => void): void {
    for (let i = 0; i < list.length; i++) f(list[i]);
    backwards(list, f);
}

function throughArrow<T>(list: T[], f: (x: T) => void): void {
    each(list, x => { f(x); f(x); });
}

function total(rows: Row[], work: number): number {
    let sum = 0;
    let trail = "";
    each(rows, row => {
        sum = sum * 3 + row.id;
        sum %= 1000003;
        if (trail.length < 12) trail += row.name[0];
    });
    return sum + trail.length + work;
}

function totalThroughArrow(rows: Row[], work: number): number {
    let sum = work;
    throughArrow(rows, row => { sum = (sum * 5 + row.id) % 1000003; });
    return sum + work;
}

const world: any = { total, totalThroughArrow };
(globalThis as any).world = world;

const rows: Row[] = [];
for (let i = 0; i < 12; i++) rows.push({ id: i, name: "row" + i });
const alike: any = { length: 3, 0: { id: 5, name: "a" }, 1: { id: 7, name: "b" }, 2: { id: 9, name: "c" } };

let printed = 0;
for (let turn = 0; turn < 40; turn++)
    printed = (printed + (globalThis as any).world.total(turn % 3 === 2 ? alike : rows, turn) + (globalThis as any).world.totalThroughArrow(turn % 5 === 4 ? alike : rows, turn)) % 1000003;
console.log(printed);
console.log(world.total(rows, 1), world.total(alike, 2), world.totalThroughArrow(rows, 3), world.totalThroughArrow(alike, 4));
