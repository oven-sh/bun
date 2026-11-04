// A number is spelled only to be appended, under every radix, one that is left out, undefined, a fraction, a text, an object that converts, and those that are refused.
let log = "";
function spelled(x: number, radix: unknown, turns: number): string {
    let text = "";
    for (let i = 0; i < turns; i++)
        text += (x + i).toString(radix as number) + ";";
    return text;
}

function deed(x: number, radix: unknown) {
    try {
        console.log(spelled(x, radix, 2), log);
    } catch (error) {
        console.log((error as Error).name, log);
    }
    log = "";
}

for (let radix = 2; radix <= 36; radix += 2)
    deed(254.5, radix);
deed(254, 10);
deed(254, undefined);
deed(254, 10.9);
deed(254, "10");
deed(254, "16");
deed(254, { valueOf() { log += "v"; return 10; } });
deed(254, { valueOf() { log += "v"; return 2; } });
deed(254, null);
deed(254, 0);
deed(254, 1);
deed(254, 37);
deed(254, NaN);
deed(-0, 10);
deed(NaN, 16);
deed(-Infinity, 2);
