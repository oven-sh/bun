// The length of a text that grows is read in front of an append and behind it, in one stretch of code without a branch.
function measure(parts: string[]): string {
    let text = "";
    let seen = "";
    for (let i = 0; i < parts.length; i++) {
        const before = text.length;
        text += parts[i];
        const between = text.length;
        text += "|";
        seen += before + "<" + between + "<" + text.length + " ";
    }
    return seen + text;
}

function deed(parts: string[]) {
    console.log(measure(parts));
}

deed([]);
deed(["a"]);
deed(["", "", ""]);
deed(["ab", "", "Āā", "😀", "x".repeat(70000), "end"].map(part => part.length > 100 ? part.slice(0, 3) : part));
for (let turn = 0; turn < 3; turn++)
    deed(["t" + turn, String(turn)]);
console.log(measure(["x".repeat(70000), "y"]).length);
