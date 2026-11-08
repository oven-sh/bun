interface Row { id: number }

function scan(rows: Row[], skip: (id: number) => boolean): number {
    var last: number | undefined;
    let i = 0;
    for (;;) {
        const id = rows[i].id;
        if (skip(id)) { i++; continue; }
        last = id;
        break;
    }
    const bump = () => { last = (last ?? 0) + 1; };
    bump();
    return last ?? -1;
}

function scanOn(rows: Row[], skip: (id: number) => boolean): number {
    var last: number | undefined;
    let i = 0;
    for (;;) {
        const id = rows[i].id;
        if (skip(id)) { i++; continue; }
        last = id;
        if (id > 6) break;
        i++;
    }
    const bump = () => { last = (last ?? 0) + 1; };
    bump();
    return last ?? -1;
}

const skips: ((id: number) => boolean)[] = [(id) => id < 1, (id) => id < 2, (id) => id < 3, (id) => id < 4, (id) => id < 5, (id) => id < 6];
const rows: Row[] = [];
for (let i = 0; i < 9; i++) rows.push({ id: i });
let out = "";
for (let n = 0; n < 6; n++) out += scan(rows, skips[n]) + ",";
console.log(out);
out = "";
for (let n = 0; n < 6; n++) out += scanOn(rows, skips[n]) + ",";
console.log(out);
