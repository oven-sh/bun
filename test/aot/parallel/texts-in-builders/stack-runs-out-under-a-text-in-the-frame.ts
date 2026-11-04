// The stack runs out between two appends to a text whose builder lies in the frame of every activation; the caller catches, and the function answers again.
function nest(depth: number, limit: number): number {
    let text = "d";
    let below = 0;
    for (let i = 0; i < 3; i++) {
        text += i;
        if (i === 1 && depth < limit)
            below = nest(depth + 1, limit);
        text += ",";
    }
    return below + text.length;
}

function deed(limit: number) {
    try {
        console.log(limit, nest(0, limit));
    } catch (error) {
        console.log(limit, (error as Error).name);
    }
}

deed(0);
deed(3);
deed(Infinity);
deed(3);
for (let turn = 0; turn < 3; turn++)
    deed(turn ? Infinity : 50);
deed(200);
