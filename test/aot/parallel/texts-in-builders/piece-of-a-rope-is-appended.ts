// The string that pieces are taken from is a rope, a piece of a longer string, and a rope of wide and narrow halves: the builder takes ranges of it that lie in one half and across both.
function windows(line: string, width: number): string {
    let text = "";
    for (let i = 0; i < line.length; i += 3)
        text += line.slice(i, i + width) + "/";
    return text;
}

function deed(left: string, right: string) {
    const rope = left + right;
    console.log(windows(rope, 2), windows(left + right + left, 5).length);
    const piece = (left + "0123456789" + right).slice(2, -1);
    console.log(windows(piece, 4));
}

deed("", "");
deed("abc", "");
deed("abcdefg", "hijklmnop");
deed("narrow", "wĀdé");
deed("Āā", "plain");
for (let turn = 0; turn < 3; turn++)
    deed("t" + turn + "x".repeat(turn * 70), "y".repeat(90) + turn);
