// A text whose builder lies in the frame passes the 128 characters of the record at every offset, by a part of every kind.
// COUNT: operation:operationAOTStackStringBuilderFinish >= 1
function filled(fill: number, last: string | number | boolean | null | undefined): string {
    let text = "";
    for (let i = 0; i < fill; i++)
        text += "x";
    for (let i = 0; i < 2; i++)
        text += last;
    return text;
}

function deed(last: string | number | boolean | null | undefined) {
    let seen = "";
    for (let fill = 118; fill < 132; fill++) {
        const text = filled(fill, last);
        seen += text.length + text.slice(fill - 1) + " ";
    }
    console.log(seen);
}

deed("");
deed("y");
deed("yzyzyzyz");
deed(7);
deed(-1234567.5);
deed(true);
deed(null);
deed(undefined);
deed("Ā");
deed("y".repeat(200));
