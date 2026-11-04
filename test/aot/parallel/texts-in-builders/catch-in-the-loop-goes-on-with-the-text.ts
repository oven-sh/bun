// A `try` in a loop grows a text, its `catch` reads the text and the loop goes on growing it: some turns throw, the first and the last among them.
function cell(value: number, bad: Set<number>): string {
    if (bad.has(value))
        throw new Error("bad " + value);
    return "c" + value;
}

function build(count: number, bad: Set<number>): string {
    let text = "";
    const seen: string[] = [];
    for (let i = 0; i < count; i++) {
        try {
            text += "[" + cell(i, bad) + "]";
        } catch (error) {
            seen.push((error as Error).message + "@" + text.length + "=" + text);
        }
    }
    return text + " | " + seen.join(" | ");
}

function deed(bad: number[]) {
    console.log(build(5, new Set(bad)));
}

deed([]);
deed([0]);
deed([4]);
deed([0, 1, 2, 3, 4]);
deed([1, 3]);
for (let turn = 0; turn < 5; turn++)
    deed([turn]);
