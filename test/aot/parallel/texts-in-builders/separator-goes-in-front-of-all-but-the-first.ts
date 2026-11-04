// `if (line) line += ","`: the truth and the emptiness of a text that grows, where the first parts may be empty.
function byTruth(cells: any[]): string {
    let line = "";
    for (let i = 0; i < cells.length; i++) {
        if (line)
            line += ",";
        line += cells[i];
    }
    return line;
}

function byEmptiness(cells: any[]): string {
    let line = "";
    for (let i = 0; i < cells.length; i++) {
        if (line !== "")
            line += ";";
        if (!(line === "") && cells[i] === "")
            line += "(none)";
        line += cells[i];
    }
    return line;
}

function deed(cells: any[]) {
    console.log(JSON.stringify(byTruth(cells)), JSON.stringify(byEmptiness(cells)));
}

deed([]);
deed([""]);
deed(["", ""]);
deed(["", "", "a", "", "b"]);
deed([0, "", null, undefined, false]);
deed(["0"]);
deed([" ", " "]);
for (let turn = 0; turn < 3; turn++)
    deed([turn, "", turn]);
