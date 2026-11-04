// The loop itself throws, under a `catch` that reads nothing of the error and reads the text.
function build(rows: number, failsAt: number): string {
    let text = "";
    try {
        for (let row = 0; row < rows; row++) {
            if (row === failsAt)
                throw new Error("stop");
            text += "r" + row + ";";
        }
    } catch {
        return "caught " + text.length + " " + text;
    }
    return text;
}

function deed(failsAt: number) {
    console.log(build(4, failsAt));
}

for (let failsAt = -1; failsAt < 5; failsAt++)
    deed(failsAt);
