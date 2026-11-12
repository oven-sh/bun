// Under: --aot-check=Validate: on a rare way the code makes the scope out of its registers, lends it to a call and reads the slots back: the allocation that fills them vouches for those reads
interface Row { id: number; name: string; }

function each<T>(list: T[], f: (x: T) => void): void { for (let i = 0; i < list.length; i++) f(list[i]); }

function above(rows: Row[], least: number): number {
    let limit = least;
    if (least < 0) limit = 0;
    let label = "from " + limit;
    if (least > 8) label = "high";
    let count = 0;
    let sum = 0;
    each(rows, row => {
        if (row.id > limit) {
            count += 1;
            sum += row.id + label.length;
        }
    });
    limit += 1;
    return count * 10000 + sum * 10 + limit + label.length;
}

function aboveTwice(rows: Row[], others: Row[], least: number): number {
    let limit = least;
    if (least < 0) limit = 0;
    let count = 0;
    each(rows, row => { if (row.id > limit) count += 1; });
    limit = count;
    each(others, row => { if (row.id > limit) count += 2; });
    return count * 100 + limit;
}

const world: any = { above, aboveTwice };
(globalThis as any).world = world;

const rows: Row[] = [];
for (let i = 0; i < 12; i++) rows.push({ id: i, name: "row" + i });
const alike: any = { length: 3, 0: { id: 5, name: "a" }, 1: { id: 7, name: "bcd" }, 2: { id: 9, name: "ef" } };

let printed = 0;
for (let turn = 0; turn < 40; turn++)
    printed += (globalThis as any).world.above(turn % 4 === 3 ? alike : rows, turn % 11 - 2);
console.log(printed);
console.log(world.above(rows, 4), world.above(alike, 6), world.above([], 3), world.above(rows, -3), world.above(rows, 9));
console.log(world.aboveTwice(rows, alike, 1), world.aboveTwice(alike, rows, 2), world.aboveTwice(alike, alike, -1), world.aboveTwice(rows, rows, 4));
