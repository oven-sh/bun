// The join that a small function returns goes into a row of its caller, and is also kept by the callee, compared by the caller, and used as a key.
const seen: string[] = [];
function tag(n: number): string {
    const text = "[" + n + "]";
    seen.push(text);
    return text;
}

function line(n: number): string {
    return "<" + tag(n) + ">";
}

function both(n: number): string {
    const text = tag(n);
    const table: Record<string, number> = { "[1]": 10, "[2.5]": 25 };
    return "<" + text + ">" + text.length + (text === "[1]") + table[text];
}

function deed(n: number) {
    console.log(line(n), both(n), seen.join(" "));
    seen.length = 0;
}

deed(1);
deed(2.5);
deed(-0);
for (let turn = 0; turn < 3; turn++)
    deed(turn);
deed(NaN);
