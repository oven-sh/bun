// The text that has grown in the frame is the argument of a call in tail position: the frame is gone when the callee reads it.
function shown(text: string, more: number): string {
    return more ? shown(text + "+", more - 1) : text.length + ":" + text.slice(-6);
}

function built(prefix: string, turns: number): string {
    let text = prefix;
    for (let i = 0; i < turns; i++) {
        if (i === 70)
            return shown(text, 1);
        text += i;
    }
    return shown(text, 2);
}

function deed(prefix: string, turns: number) {
    console.log(built(prefix, turns));
}

deed("", 0);
deed("p", 0);
deed("p", 1);
deed("", 9);
deed("p", 60);
for (let turn = 0; turn < 3; turn++)
    deed("t" + turn, 69 + turn);
