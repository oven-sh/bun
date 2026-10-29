// Ten awaits in a row whose results all live to the end of the function. At each position in turn the awaited value is not what its type says, and the rest of the function goes on as in plain Bun.
type Row = { id: number; name: string; tags: string[] };

function later<T>(value: T): Promise<T> {
    return new Promise(resolve => setTimeout(() => resolve(value), 0));
}

function makeRow(id: number, isOther: boolean): Row {
    if (isOther) {
        const other: any = { tags: ["x"], extra: true, name: "other" + id, id: String(id) };
        return other;
    }
    return { id, name: "row" + id, tags: ["a" + id, "b"] };
}

async function tenInARow(seed: number, otherAt: number): Promise<string> {
    const a = await later(makeRow(seed, otherAt === 0));
    const b = await later(makeRow(a.id + 1, otherAt === 1));
    const c = await later(makeRow(b.id + 1, otherAt === 2));
    const d = await later(makeRow(c.id + 1, otherAt === 3));
    const e = await later(makeRow(d.id + 1, otherAt === 4));
    const f = await later(makeRow(e.id + 1, otherAt === 5));
    const g = await later(makeRow(f.id + 1, otherAt === 6));
    const h = await later(makeRow(g.id + 1, otherAt === 7));
    const i = await later(makeRow(h.id + 1, otherAt === 8));
    const j = await later(makeRow(i.id + 1, otherAt === 9));
    return [a, b, c, d, e, f, g, h, i, j].map(row => row.name + ":" + row.tags.length + ":" + typeof row.id).join(",");
}

for (let otherAt = -1; otherAt < 10; otherAt++)
    console.log(await tenInARow(1, otherAt));
