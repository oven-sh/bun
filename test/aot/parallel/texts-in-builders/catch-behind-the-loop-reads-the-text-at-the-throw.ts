// A loop under `try` grows a text, and the `catch` behind the loop reads it: the throw comes at each point where the try can throw, in each turn.
function step(at: number, failsAt: number): string {
    if (at === failsAt)
        throw new Error("at " + at);
    return "s" + at;
}

function build(rows: number, failsAt: number): string {
    let text = "begin;";
    let at = 0;
    try {
        step(at++, failsAt);
        for (let row = 0; row < rows; row++) {
            text += step(at++, failsAt);
            text += "(" + step(at++, failsAt) + "," + row + ")";
            step(at++, failsAt);
            text += ";";
        }
        step(at++, failsAt);
        text += "end";
    } catch (error) {
        return (error as Error).message + " > " + text + " > " + text.length;
    }
    return text;
}

function deed(failsAt: number) {
    console.log(build(3, failsAt));
}

for (let failsAt = -1; failsAt < 12; failsAt++)
    deed(failsAt);
console.log(build(0, 0), build(0, 1), build(0, 2));
