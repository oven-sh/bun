// `text += flag ? "yes" : other`: the part of a text that grows depends on the way, and what stands behind it in the same join converts with a side effect.
const log: string[] = [];

function build(flags: boolean[], other: any, tail: any): string {
    let text = "";
    for (let i = 0; i < flags.length; i++) {
        text += (flags[i] ? "yes" : "no") + tail;
        text += flags[i] ? i : other;
        text += flags[i] ? "" : ";";
    }
    return text;
}

function deed(flags: boolean[], other: any, tail: any) {
    log.length = 0;
    try {
        console.log(JSON.stringify(build(flags, other, tail)));
    } catch (error) {
        console.log("threw", String(error));
    }
    console.log(log.join(","));
}

const talks = { toString() { log.push("asked"); return "T"; } };
const fails = { toString() { log.push("fails"); throw "no text"; } };
deed([], "o", "t");
deed([true, false, true], "o", "/");
deed([false, false], 1.5, null);
deed([true, false], talks, talks);
deed([true, true], fails, "/");
deed([true, false], fails, "/");
deed([false], "o", fails);
for (let turn = 0; turn < 3; turn++)
    deed([turn % 2 === 0, turn % 2 === 1], turn, "|");
