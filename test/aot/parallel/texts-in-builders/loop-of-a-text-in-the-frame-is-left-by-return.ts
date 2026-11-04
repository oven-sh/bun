// A return in the middle of a turn leaves the loop of a text whose builder lies in the frame, in front of an append, behind one, and with more joined behind the text.
function until(stop: number, how: number): string {
    let text = "<";
    for (let i = 0; i < 200; i++) {
        if (i === stop && how === 0)
            return text;
        text += i;
        if (i === stop && how === 1)
            return text;
        if (i === stop && how === 2)
            return text + "!" + i;
        text += ",";
    }
    return text + ">";
}

function deed(stop: number) {
    for (let how = 0; how < 3; how++) {
        const text = until(stop, how);
        console.log(stop, how, text.length, text.slice(-9));
    }
}

deed(0);
deed(1);
deed(40);
deed(199);
deed(200);
for (let turn = 0; turn < 3; turn++)
    deed(turn * 30 + 5);
