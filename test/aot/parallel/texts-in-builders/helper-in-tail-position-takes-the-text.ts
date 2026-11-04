// `return add(text, x)` in the loop: the call in tail position takes the text that grows through the same helper in the other turns.
function add(text: string, part: string): string {
    return text + part + ";";
}

function build(parts: string[], stopAt: number): string {
    let text = "";
    for (let i = 0; i < parts.length; i++) {
        if (i === stopAt)
            return add(text, "stop");
        text = add(text, parts[i]);
    }
    return text;
}

function deed(stopAt: number) {
    const made = build(["a", "b", "c", "d"], stopAt);
    console.log(typeof made, made.length, made);
}

for (let stopAt = -1; stopAt < 5; stopAt++)
    deed(stopAt);
