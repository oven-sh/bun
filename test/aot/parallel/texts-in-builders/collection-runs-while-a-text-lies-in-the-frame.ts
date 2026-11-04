// The collector runs between two appends to a text whose builder lies in the frame, while the text is short and when it has moved into the heap.
// COUNT: operation:operationAOTStackStringBuilderFinish >= 1
function collected(prefix: string, turns: number, every: number): string {
    let text = prefix;
    for (let i = 0; i < turns; i++) {
        text += "k" + i;
        if (i % every === 0)
            Bun.gc(true);
        text += ",";
    }
    return text;
}

function deed(prefix: string, turns: number, every: number) {
    const text = collected(prefix, turns, every);
    console.log(text.length, text.slice(0, 24), text.slice(-12));
}

deed("", 0, 1);
deed("", 3, 1);
deed("p" + String(Date.length), 3, 1);
deed("", 90, 7);
for (let turn = 0; turn < 4; turn++)
    deed("t" + turn, 40 + turn, 5);
deed("Ā", 60, 9);
Bun.gc(true);
deed(collected("again", 50, 11), 2, 1);
