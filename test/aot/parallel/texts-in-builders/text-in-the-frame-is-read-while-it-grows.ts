// A turn takes the text as a string between two appends and keeps it: what was kept stays as it was while the builder in the frame goes on, under and over the 128 characters of the record.
function snapshots(turns: number, every: number): string[] {
    const kept: string[] = [];
    let text = "";
    for (let i = 0; i < turns; i++) {
        text += "a" + i;
        if (i % every === 0)
            kept.push(text);
        text += "b";
    }
    kept.push(text);
    return kept;
}

function deed(turns: number, every: number) {
    const kept = snapshots(turns, every);
    let seen = "";
    for (let i = 0; i < kept.length; i++)
        seen += kept[i].length + kept[i].slice(-4) + " ";
    console.log(seen);
}

deed(0, 1);
deed(1, 1);
deed(5, 1);
deed(5, 2);
deed(70, 9);
for (let turn = 1; turn < 4; turn++)
    deed(45, turn * 10);
