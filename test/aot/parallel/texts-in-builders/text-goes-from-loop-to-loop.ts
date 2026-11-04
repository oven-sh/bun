// One text grows in a loop and goes on growing in the next: either loop may make no turn, and the text between the two is kept by nobody or by a constant.
function straight(first: number, second: number): string {
    let text = "";
    for (let i = 0; i < first; i++)
        text += "a" + i;
    for (let j = 0; j < second; j++)
        text += "b" + j;
    return text;
}

function kept(first: number, second: number): string {
    let text = "";
    for (let i = 0; i < first; i++)
        text += "a" + i;
    const between = text;
    for (let j = 0; j < second; j++)
        text += "b" + j;
    return between + "/" + text + "/" + (between === text);
}

function leftEarly(first: number, second: number, stop: number): string {
    let text = ">";
    for (let i = 0; i < first; i++) {
        if (i === stop)
            break;
        text += i;
    }
    for (let j = 0; j < second; j++) {
        if (j === stop)
            return "returned " + text;
        text += "-" + j;
    }
    return text;
}

function deed(first: number, second: number) {
    console.log(straight(first, second), kept(first, second), leftEarly(first, second, 2));
}

deed(0, 0);
deed(0, 3);
deed(3, 0);
deed(3, 3);
deed(1, 1);
for (let turn = 0; turn < 3; turn++)
    deed(turn, 4 - turn);
