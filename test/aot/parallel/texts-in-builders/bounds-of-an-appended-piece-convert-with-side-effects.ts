// The bounds of a piece that is only appended are objects that convert: each valueOf runs once, the first bound in front of the second, and one that throws ends the turn with nothing appended.
let log = "";
function bound(name: string, value: number, bad = false) {
    return { valueOf() { log += name; if (bad) throw new RangeError(name); return value; } };
}

function cut(line: string, from: unknown, to: unknown, turns: number): string {
    let text = "";
    for (let i = 0; i < turns; i++)
        text += "<" + line.slice(from as number, to as number) + ">";
    return text;
}

function deed(from: unknown, to: unknown, turns: number) {
    try {
        console.log(cut("abcdef", from, to, turns), log);
    } catch (error) {
        console.log((error as Error).name, (error as Error).message, log);
    }
    log = "";
}

deed(1, 3, 2);
deed(bound("f", 1), bound("t", 3), 2);
deed(bound("f", 4), bound("t", 1), 1);
deed("1", "3", 2);
deed(null, undefined, 1);
deed(bound("f", 1, true), bound("t", 3), 2);
deed(bound("f", 1), bound("t", 3, true), 2);
deed(bound("f", 1), bound("t", 3), 0);
for (let turn = 0; turn < 3; turn++)
    deed(turn, bound("t", 5 - turn), 1);
deed(1n, 3, 1);
deed(Symbol("s"), 3, 1);
