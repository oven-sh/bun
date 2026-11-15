const outside: unknown[] = [];
function ofAnything(text: any, part: any): unknown { return text.lastIndexOf(part); }
function ofAnythingAt(text: any, part: any, at: any): unknown { return text.lastIndexOf(part, at); }
function fold(sum: number, text: string): number { for (let at = 0; at < text.length; at++) sum = (sum * 31 + text.charCodeAt(at)) % 1000003; return sum; }
const made: string[] = JSON.parse('["..abcdefabcdefabcdefabcdef..", "..ef..", "__abcdef__", "--ab--", "..cd", "aaaaaaaaaaaaaaaabaaaaaaaaaaaaaaaa", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "\\u0100abcdef\\u0100ef", "aaaaaaaaaaaaaaaabaaaaaaaaaaaaaaa"]');
const cuts: [number, number, number][] = [[0, 2, 26], [1, 2, 4], [2, 2, 8], [3, 2, 4], [4, 2, 4], [0, 2, 8], [0, 4, 6], [5, 0, 33], [5, 1, 33], [6, 0, 40], [6, 3, 36], [6, 0, 33], [7, 1, 7], [7, 8, 10], [7, 6, 10], [8, 0, 32], [6, 4, 36]];
const answers: string[] = [];
for (const [textBase, textFrom, textTo] of cuts) {
    for (const [partBase, partFrom, partTo] of cuts) {
        const half = (partFrom + partTo) >> 1;
        const text = made[textBase].substring(textFrom, textTo), whole = made[partBase];
        answers.push(String(ofAnything(text, whole.substring(partFrom, half) + whole.substring(half, partTo))));
        answers.push(String(ofAnything(made[textBase], whole.charAt(partFrom) + whole.substring(partFrom + 1, partTo))));
        answers.push(String(ofAnything(text, whole.substring(partFrom, partTo - 1) + whole.charAt(partTo - 1))));
        answers.push(String(ofAnything(text, whole.substring(partFrom, partTo - 1) + "!")));
        answers.push(String(ofAnything(text, "!" + whole.substring(partFrom + 1, partTo))));
        answers.push(String(ofAnything(text, (whole.charAt(partFrom) + whole.substring(partFrom + 1, half + 1)) + whole.substring(half + 1, partTo))));
        answers.push(String(ofAnything(text + made[1].substring(2, 4), whole.substring(partFrom, half) + whole.substring(half, partTo))));
        for (const at of [-1, 0, 1, 2, 4, 6, 22])
            answers.push(String(ofAnythingAt(text, whole.substring(partFrom, half) + whole.substring(half, partTo), at)));
    }
}
console.log("lastIndexOf", fold(0, answers.join(",")), answers.length, answers.slice(0, 56).join(","));
const kept: string[] = [];
for (const first of ["a", "e", "-", "c"]) for (const [base, from, to] of cuts) kept.push(first + made[base].substring(from, to));
let found = 0;
for (let round = 0; round < 40; round++)
    for (const [base, from, to] of cuts)
        for (const part of kept) {
            const answer = ofAnything(made[base].substring(from, to), part);
            if (answer === true || (typeof answer === "number" && answer >= 0)) found++;
        }
console.log(found, kept.length);
outside.push(ofAnything, ofAnythingAt);
