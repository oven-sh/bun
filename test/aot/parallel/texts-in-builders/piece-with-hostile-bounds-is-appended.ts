// Pieces are cut only to be appended to a text that grows, with bounds that are negative, in the wrong order, fractions, NaN, infinite, -0, at the end and behind it.
function cut(line: string, bounds: number[]): string {
    let text = "";
    for (let i = 0; i + 1 < bounds.length; i++) {
        text += line.slice(bounds[i], bounds[i + 1]) + "|";
        text += line.substring(bounds[i], bounds[i + 1]) + "|";
        text += line.substr(bounds[i], bounds[i + 1]) + "|";
        text += line.charAt(bounds[i]) + ";";
    }
    return text;
}

function deed(line: string) {
    console.log(JSON.stringify(cut(line, [0, 2, 1, -1, -3, 1.5, 3.9, NaN, 2, Infinity, 0, -Infinity, 4, -0, line.length, line.length + 1, 2 ** 31, -(2 ** 31), 2 ** 32 + 1, 1e300, 0])));
}

deed("");
deed("a");
deed("abcdef");
for (let turn = 0; turn < 3; turn++)
    deed("abcdefgh".slice(turn));
deed("aĀbéc😀d");
