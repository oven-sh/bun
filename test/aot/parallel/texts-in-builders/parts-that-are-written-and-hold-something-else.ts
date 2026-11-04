// Several parts of one join are written numbers and strings, and some hold something else: every part is converted as the template or `+` converts it, in the order in which they stand, and what throws leaves the loop with nothing appended of that turn that a catch could see.
const log: string[] = [];
type Row = { id: number; title: string; cents: number };

function lines(rows: Row[]): string {
    let text = "";
    for (const row of rows)
        text += `${row.id},${row.title},${row.cents}\n`;
    return text;
}

function sums(rows: Row[]): string {
    let text = "";
    for (let i = 0; i < rows.length; i++)
        text = text + rows[i].id + rows[i].title + rows[i].cents;
    return text;
}

function caught(rows: Row[]): string {
    let text = "";
    try {
        for (const row of rows)
            text += `${row.id}|${row.title}|${row.cents};`;
    } catch (thrown) {
        return text + "!" + (thrown as Error).name;
    }
    return text;
}

function noisy(name: string, value: unknown) {
    return {
        valueOf() {
            log.push(name + "v");
            return value;
        },
        toString() {
            log.push(name + "s");
            return String(value);
        },
    };
}

function deed(rows: unknown[], builders = [lines, sums, caught]) {
    for (const build of builders) {
        try {
            const made = build(rows as Row[]);
            console.log(build.name, made.length, JSON.stringify(made));
        } catch (thrown) {
            console.log(build.name, (thrown as Error).name);
        }
        console.log(log.join(" "));
        log.length = 0;
    }
}

const good = (id: number): Row => ({ id, title: "t" + id, cents: id * 100 + 0.5 });
deed([]);
deed([good(1), good(2), good(3)]);
for (const odd of [undefined, null, true, 10n, "text", 2.5, -0, NaN, noisy("a", 7), [1, 2], {}]) {
    deed([good(1), { id: odd, title: "t", cents: 1 }, good(2)]);
    deed([good(1), { id: 1, title: odd, cents: 1 }, good(2)]);
    deed([good(1), { id: 1, title: "t", cents: odd }, good(2)]);
}
deed([good(1), { id: noisy("i", 1), title: noisy("t", "T"), cents: noisy("c", 2) }]);
// Not the chain of `+`: with a symbol in front of an object plain Bun converts every operand first: chain-of-joins-with-a-symbol-in-front-of-an-object.ts.
deed([good(1), { id: noisy("i", 1), title: Symbol("s"), cents: noisy("c", 2) }, good(2)], [lines, caught]);
deed([good(1), { id: Symbol("s"), title: noisy("t", "T"), cents: noisy("c", 2) }, good(2)], [lines, caught]);
deed([good(1), { id: 1, title: "t", cents: { valueOf() { log.push("throws"); throw new RangeError("no"); }, toString() { log.push("throws"); throw new RangeError("no"); } } }, good(2)]);
deed([good(1), { title: "no id" }, good(2)]);
for (let turn = 0; turn < 3; turn++)
    deed([good(turn), good(turn + 1)]);
