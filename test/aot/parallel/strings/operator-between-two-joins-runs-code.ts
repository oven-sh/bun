// Between two joins of one row stands a sum whose operand is written as a number and is an object that converts, a text, a BigInt, a symbol: its code runs where the sum stands, and a throw ends the row there.
let log = "";
function cell(name: string, index: number): string {
    return name + "[" + (index + 1) + "," + index * 2 + "," + -index + "]";
}

function noisy(value: unknown, bad = false) {
    return { valueOf() { log += "v"; if (bad) throw new RangeError("bad"); return value; }, toString() { log += "s"; return "text"; } };
}

function deed(name: string, index: unknown) {
    try {
        console.log(cell(name, index as number), log);
    } catch (error) {
        console.log((error as Error).name, log);
    }
    log = "";
}

deed("a", 1);
deed("a", -0);
deed("a", 2 ** 53);
deed("a", noisy(4));
deed("a", noisy("4"));
deed("a", noisy(4, true));
deed("a", "4");
deed("a", 4n);
deed("a", Symbol("s"));
deed("a", null);
deed("a", undefined);
for (let turn = 0; turn < 3; turn++)
    deed("t" + turn, turn === 1 ? noisy(turn) : turn);
deed("a", 1);
