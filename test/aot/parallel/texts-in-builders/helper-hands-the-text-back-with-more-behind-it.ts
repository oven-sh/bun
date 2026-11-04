// `text = add(text, x)`: a small helper hands its first parameter back with more behind it. The part is a number, a text, an object that converts with a side effect, and one that throws.
const log: string[] = [];

function add(text: string, part: any): string {
    return text + part + ";";
}

function build(parts: any[]): string {
    let text = "";
    let lengths = "";
    for (let i = 0; i < parts.length; i++) {
        text = add(text, parts[i]);
        lengths += text.length + " ";
    }
    return text + " " + lengths;
}

function deed(parts: any[]) {
    log.length = 0;
    try {
        console.log(build(parts));
    } catch (error) {
        console.log("threw", String(error));
    }
    console.log(log.join(","));
}

const talks = { toString() { log.push("asked"); return "T"; } };
const fails = { toString() { log.push("fails"); throw "no text"; } };
deed([]);
deed([1, "two", 3.5, null, undefined, true, 10n]);
deed([talks, talks]);
deed([1, fails, 3]);
deed([add("x", "y"), add("", "")]);
for (let turn = 0; turn < 3; turn++)
    deed([turn, talks]);
