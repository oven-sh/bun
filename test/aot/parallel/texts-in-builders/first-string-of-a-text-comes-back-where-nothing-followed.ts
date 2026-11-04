// A text begins with a string, and every turn appends a string that may be empty: where all were empty the text is the string that it began with, which is then compared, measured and used as a key.
function padded(prefix: string, parts: string[]): string {
    let text = prefix;
    for (let i = 0; i < parts.length; i++)
        text += parts[i];
    return text;
}

function deed(prefix: string, parts: string[]) {
    const text = padded(prefix, parts);
    const table: Record<string, number> = { [prefix]: 1 };
    console.log(JSON.stringify(text.slice(0, 20)), text.length, text === prefix, table[text], text.charCodeAt(text.length - 1));
}

const rope = "left" + String(Date.length) + "right" + String(Math.max(3, 4));
deed("", []);
deed("", ["", ""]);
deed("a", []);
deed("a", ["", "", ""]);
deed("a", ["", "b", ""]);
deed("length", [""]);
deed("1", [""]);
deed(rope, ["", ""]);
deed(rope, ["", "!"]);
deed("Ā", [""]);
deed("Ā", ["", "é"]);
deed("\ud83d", ["", "\ude00"]);
deed("x".repeat(127), [""]);
deed("x".repeat(128), [""]);
deed("x".repeat(129), ["", ""]);
deed("x".repeat(5000), [""]);
deed("x".repeat(5000), ["", "y"]);
for (let turn = 0; turn < 3; turn++)
    deed("t" + turn, turn === 1 ? ["+"] : [""]);
