// What a template takes as a number is an object that converts, a symbol, a BigInt, null: toString runs in front of valueOf, once, where the part stands among the other parts.
let log = "";
function sized(width: number, height: number): string {
    return `${width}px by ${height}px`;
}

function noisy(name: string, text: unknown) {
    return { toString() { log += name + "s"; return text; }, valueOf() { log += name + "v"; return text; } };
}

function deed(width: unknown, height: unknown) {
    try {
        console.log(sized(width as number, height as number), log);
    } catch (error) {
        console.log((error as Error).name, log);
    }
    log = "";
}

deed(1, 2);
deed(-0, NaN);
deed(noisy("w", "W"), noisy("h", "H"));
deed(noisy("w", {}), noisy("h", "H"));
deed(1, noisy("h", 5));
deed(noisy("w", "W"), Symbol("s"));
deed(Symbol("s"), noisy("h", "H"));
deed(10n, null);
deed(undefined, [1, [2]]);
for (let turn = 0; turn < 3; turn++)
    deed(turn === 1 ? noisy("w", turn) : turn, turn * 1.5);
deed(1, 2);
