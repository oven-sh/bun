// What is written as a string, and sliced only to be appended, is a list, a String object, an object with a slice of its own, a number, null.
function cut(line: string, turns: number): string {
    let text = "";
    for (let i = 0; i < turns; i++)
        text += line.slice(i, i + 2) + "|";
    return text;
}

function deed(line: unknown, turns: number) {
    try {
        console.log(cut(line as string, turns));
    } catch (error) {
        console.log((error as Error).name);
    }
}

deed("abcd", 3);
deed(["a", "b", "c", "d"], 3);
deed(new String("abcd"), 3);
deed({ slice(from: number, to: number) { return from * 10 + to; } }, 3);
deed({ slice(from: number) { return from ? undefined : null; } }, 2);
deed(1234, 2);
deed(null, 2);
deed(null, 0);
deed(undefined, 1);
for (let turn = 0; turn < 3; turn++)
    deed(turn === 1 ? [turn, turn] : "t" + turn, 2);
deed("abcd", 3);
