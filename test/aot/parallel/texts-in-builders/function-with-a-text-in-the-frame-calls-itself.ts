// A function whose text lies in its frame calls itself in the middle of a row of parts: every activation has a record of its own, and the outer one goes on with its cursor behind the call.
function tree(depth: number, width: number): string {
    let text = "(";
    for (let i = 0; i < width; i++)
        text += i + ":" + (depth ? tree(depth - 1, width) : "leaf") + ";";
    return text + ")";
}

function deed(depth: number, width: number) {
    const text = tree(depth, width);
    console.log(depth, width, text.length, text.slice(0, 30), text.slice(-14));
}

deed(0, 0);
deed(0, 2);
deed(1, 2);
deed(3, 2);
deed(2, 5);
for (let turn = 0; turn < 3; turn++)
    deed(turn, 3);
deed(6, 3);
