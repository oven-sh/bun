// What a turn calls throws out of the function whose text lies in the frame; the caller catches in a loop of its own and calls again, so the same record is begun anew over what the throw left.
let calls = 0;
function part(i: number, bad: number): string {
    calls++;
    if (i === bad)
        throw new RangeError("part " + i);
    return "p" + i;
}

function joined(turns: number, bad: number): string {
    let text = "";
    for (let i = 0; i < turns; i++)
        text += part(i, bad) + ",";
    return text;
}

function deed(turns: number) {
    let seen = "";
    for (let bad = -1; bad < turns + 1; bad++) {
        try {
            seen += joined(turns, bad).length + " ";
        } catch (error) {
            seen += (error as Error).message + " ";
        }
    }
    console.log(seen, calls);
}

deed(0);
deed(1);
deed(4);
deed(60);
console.log(joined(3, -1));
