interface Row { id: number; name: string; }

function each<T>(list: T[], f: (x: T) => void): void { for (let i = 0; i < list.length; i++) f(list[i]); }

function total(rows: Row[], work: number): number {
    let sum = 0;
    each(rows, row => { sum += row.id; });
    let later = sum + work;
    const bump = () => { later++; return later; };
    return bump() + bump() + sum;
}

function totalThatLooksAhead(rows: Row[], work: number): string {
    let sum = 0;
    try {
        each(rows, row => { sum += row.id > 8 ? later : row.id; });
    } catch (error) {
        return (error as Error).name + " at " + sum;
    }
    let later = work;
    each(rows, row => { sum += later; later++; });
    return "whole " + (sum + later);
}

const world: any = { total, totalThatLooksAhead };
(globalThis as any).world = world;

const rows: Row[] = [];
for (let i = 0; i < 12; i++) rows.push({ id: i, name: "row" + i });
const few: Row[] = rows.slice(0, 5);
const alike: any = { length: 3, 0: { id: 5, name: "a" }, 1: { id: 7, name: "b" }, 2: { id: 9, name: "c" } };
const alikeAndFew: any = { length: 2, 0: { id: 5, name: "a" }, 1: { id: 7, name: "b" } };

for (let turn = 0; turn < 8; turn++) {
    console.log(
        (globalThis as any).world.total(turn % 2 ? alike : rows, turn),
        (globalThis as any).world.totalThatLooksAhead(turn % 2 ? alike : rows, turn),
        (globalThis as any).world.totalThatLooksAhead(turn % 2 ? alikeAndFew : few, turn));
}
