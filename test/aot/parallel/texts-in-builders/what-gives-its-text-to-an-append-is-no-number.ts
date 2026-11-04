// What is written as a number, and asked for its text only to have it appended, is an object with a toString of its own, a string, a BigInt, a boolean, a symbol, null.
let log = "";
function spelled(x: number, turns: number): string {
    let text = "";
    for (let i = 0; i < turns; i++)
        text += x.toString() + "," + String(x) + ";";
    return text;
}

function deed(x: unknown, turns: number) {
    try {
        console.log(spelled(x as number, turns), log);
    } catch (error) {
        console.log((error as Error).name, log);
    }
    log = "";
}

deed(12, 2);
deed(-0, 1);
deed({ toString() { log += "s"; return "own"; }, valueOf() { log += "v"; return 7; } }, 2);
deed({ toString() { log += "s"; return 5; } }, 1);
deed({ toString() { log += "s"; return {}; }, valueOf() { log += "v"; return {}; } }, 1);
deed("text", 1);
deed(10n, 1);
deed(true, 1);
deed(Symbol("s"), 1);
deed(null, 1);
deed(null, 0);
deed(undefined, 1);
for (let turn = 0; turn < 3; turn++)
    deed(turn === 1 ? [turn, turn] : turn / 2, 1);
deed(12, 2);
