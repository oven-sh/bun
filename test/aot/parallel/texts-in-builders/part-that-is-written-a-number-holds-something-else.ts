// The elements are written numbers, and some are none: each is converted as `+=` or the template converts it, in the order of the turns, and what throws leaves the loop.
const log: string[] = [];

function cells(row: number[]): string {
    let line = "";
    for (const cell of row) {
        if (line)
            line += ",";
        line += cell;
    }
    return line;
}

function counted(row: number[]): string {
    let line = "";
    for (let i = 0; i < row.length; i++)
        line += row[i];
    return line;
}

function templated(row: number[]): string {
    let line = "";
    for (let i = 0; i < row.length; i++)
        line += `${row[i]};`;
    return line;
}

function caught(row: number[]): string {
    let line = "";
    try {
        for (let i = 0; i < row.length; i++)
            line += row[i];
    } catch (error) {
        return line + "!" + (error as Error).name;
    }
    return line;
}

function deed(row: unknown[]) {
    for (const build of [cells, counted, templated, caught]) {
        try {
            const made = build(row as number[]);
            console.log(build.name, typeof made, made.length, made);
        } catch (error) {
            console.log(build.name, (error as Error).name);
        }
        console.log(log.join(" "));
        log.length = 0;
    }
}

const both = {
    valueOf() {
        log.push("valueOf");
        return 7;
    },
    toString() {
        log.push("toString");
        return "seven";
    },
};
const hinted = {
    [Symbol.toPrimitive](hint: string) {
        log.push(hint);
        return hint;
    },
};
const throwing = {
    valueOf() {
        log.push("throws");
        throw new RangeError("no");
    },
    toString() {
        log.push("throws");
        throw new RangeError("no");
    },
};
const hostile: unknown[] = [1, 2.5, -0, NaN, Infinity, "text", "", null, undefined, true, 10n, both, [1, [2, 3]], hinted, new Date(0).getTime(), new String("boxed"), new Number(4)];

deed([]);
deed([1, 2, 3]);
deed(hostile);
for (const one of hostile)
    deed([1, one, 2]);
deed([1, , 3]);
deed([1, Symbol("s"), 2]);
deed([1, throwing, 2]);
deed([both, hinted, both]);
for (let turn = 0; turn < 3; turn++)
    deed([turn, turn + 0.5, 1e21, 1e-7, 2 ** 31, -(2 ** 31), 123456789012345680000, 0.1 + 0.2]);
