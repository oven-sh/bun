interface Row { id: number; name: string; }

function each<T>(list: T[], f: (x: T) => void): void { for (let i = 0; i < list.length; i++) f(list[i]); }

function caught(rows: Row[], limit: number): number {
    let sum = 0;
    try {
        each(rows, row => {
            if (row.id > limit) throw new Error("over " + row.id);
            sum += row.id;
        });
    } catch (error) {
        return -sum - (error as Error).message.length;
    }
    return sum + limit;
}

function cleanedUp(rows: Row[], limit: number, log: number[]): number {
    let sum = 0;
    try {
        each(rows, row => {
            sum += row.id;
            if (row.id > limit) throw new Error("over " + row.id);
        });
    } finally {
        log.push(sum);
    }
    return sum + limit;
}

function plain(rows: Row[], limit: number): number {
    let sum = 0;
    each(rows, row => {
        if (row.id > limit) throw new Error("sum was " + sum);
        sum += row.id;
    });
    return sum + limit;
}

function caughtAround(rows: Row[], limit: number): string {
    try {
        return "whole " + (plain(rows, limit) + 1);
    } catch (error) {
        return (error as Error).message;
    }
}

const world: any = { caught, cleanedUp, caughtAround };
(globalThis as any).world = world;

const rows: Row[] = [];
for (let i = 0; i < 12; i++) rows.push({ id: i, name: "row" + i });
const alike: any = { length: 4, 0: { id: 2, name: "a" }, 1: { id: 4, name: "b" }, 2: { id: 8, name: "c" }, 3: { id: 1, name: "d" } };

for (const list of [rows, alike, rows, alike]) {
    for (const limit of [100, 5, 3, -1]) {
        const log: number[] = [];
        let cleaned = "";
        try {
            cleaned = "whole " + (globalThis as any).world.cleanedUp(list, limit, log);
        } catch (error) {
            cleaned = (error as Error).message;
        }
        console.log((globalThis as any).world.caught(list, limit), cleaned, log.join(), (globalThis as any).world.caughtAround(list, limit));
    }
}
