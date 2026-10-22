// What a catch or a finally clause reads was made in front of the throw, in the form that its maker gives it; the clause may want another.
declare const console: { log(...values: unknown[]): void };

function fail(when: boolean, what: unknown): void { if (when) throw what; }

function counts(limit: number, failAt: number): unknown[] {
    let i = 0, half = 0.5, text = "none", flag = false, big = 2 ** 33;
    let box: unknown = 1;
    try {
        for (; i < limit; i++) {
            half += i / 2;
            text = "at " + i;
            flag = i % 2 === 1;
            big += i;
            box = i % 3 === 0 ? i : i % 3 === 1 ? "s" + i : undefined;
            fail(i === failAt, i);
        }
    } catch (error) {
        return [error, i, half, text, flag, big, box];
    }
    return ["done", i, half, text, flag, big, box];
}

function nested(n: number): string {
    let total = 0, label: string | undefined = undefined;
    try {
        try {
            total = n * 2;
            fail(n > 1, "inner " + n);
            label = "passed";
        } finally {
            total += 0.25;
        }
        total += 1;
    } catch (error) {
        label = String(error) + " " + total;
    }
    return label + " " + total;
}

function optional(n: number): unknown[] {
    let maybe: number | undefined = undefined;
    let cell: { id: number } | null = null;
    try {
        if (n > 0) maybe = n;
        fail(n === 1, "one");
        cell = { id: n };
        fail(n === 2, "two");
        maybe = undefined;
        fail(n === 3, "three");
    } catch (error) {
        return [error, maybe, cell && cell.id];
    }
    return ["none", maybe, cell && cell.id];
}

for (const failAt of [-1, 0, 1, 2, 3]) console.log(JSON.stringify(counts(4, failAt)));
console.log(nested(0), "|", nested(1), "|", nested(2));
for (let n = 0; n < 5; n++) console.log(JSON.stringify(optional(n)));
