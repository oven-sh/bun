const outside: unknown[] = [];
function glued(left: string, right: string): string { return left + right; }
function piece(text: string, from: number, to: number): string { return text.substring(from, to); }
const many = "a".repeat(40);
const texts: string[] = [
    "abcdef", "ab", "cd", "ef", "", "abcdefg", "xabcdef", "f", "a", many, many.slice(0, 32), many.slice(0, 33), many + "b", "b" + many,
    "ab\u0100def", "\u0100", "ef\u0100", "\u0100ab", glued("abc", "def"), glued("abcdefabcdefabcdef", "abcdefabcdefabcdef"), glued("e", "f"), glued("", "ef"),
    piece("..abcdefabcdefabcdefabcdef..", 2, 26), piece("..ef..", 2, 4), piece("__abcdef__", 2, 8), String(12), "12", "undefined", "null", "xundefined", "[object Object]",
];
const positions: unknown[] = [0, 1, 2, 3, 4, 5, 6, 7, -1, -7, 100, 2147483647, -2147483648, 4294967296, 1.5, -0, NaN, Infinity, -Infinity, undefined, null, "2", "x", true, { valueOf() { return 4; } }];
const others: unknown[] = [12, undefined, null, true, { toString() { return "ef"; } }, ["ef"], /ef/, Symbol("ef"), 1.5, -0];
let turns = 0;
function counted<Kind>(value: Kind): Kind { turns++; return value; }
function said(answer: () => unknown): string { try { return String(answer()); } catch (error) { return (error as Error).constructor.name; } }
function fold(sum: number, text: string): number { for (let at = 0; at < text.length; at++) sum = (sum * 31 + text.charCodeAt(at)) % 1000003; return sum; }

function byName(text: string, part: string): unknown { return text.startsWith(part); }
function byNameAt(text: string, part: string, at: number): unknown { return text.startsWith(part, at); }
function offLists(list: string[], parts: string[], one: number, other: number): unknown { return list[one].startsWith(parts[other]); }
function offListsAt(list: string[], parts: string[], one: number, other: number, at: number): unknown { return list[one].startsWith(parts[other], at); }
function behindCall(text: string, part: string): unknown { return text.startsWith(counted(part)); }
function behindCallAt(text: string, part: string, at: number): unknown { return text.startsWith(counted(part), counted(at)); }
function ofAnything(text: any, part: any): unknown { return text.startsWith(part); }
function ofAnythingAt(text: any, part: any, at: any): unknown { return text.startsWith(part, at); }
const sums = [0, 0, 0, 0, 0, 0, 0, 0];
for (let round = 0; round < 3; round++) {
    for (let one = 0; one < texts.length; one++) {
        for (let other = 0; other < texts.length; other++) {
            const text = texts[one], part = texts[other];
            sums[0] = fold(sums[0], said(() => byName(text, part)));
            sums[1] = fold(sums[1], said(() => offLists(texts, texts, one, other)));
            sums[2] = fold(sums[2], said(() => behindCall(text, part)));
            sums[3] = fold(sums[3], said(() => ofAnything(text, part)));
            for (const at of positions) {
                sums[4] = fold(sums[4], said(() => byNameAt(text, part, at as number)));
                sums[5] = fold(sums[5], said(() => offListsAt(texts, texts, one, other, at as number)));
                sums[6] = fold(sums[6], said(() => behindCallAt(text, part, at as number)));
                sums[7] = fold(sums[7], said(() => ofAnythingAt(text, part, at)));
            }
        }
    }
}
console.log("startsWith", sums.join(" "), turns);
const lines: string[] = [];
for (const text of ["abcdef", "", "ef", "12", "undefined", "null", "xundefined", "true", "1.5", "0", "[object Object]", glued("abc", "def")]) {
    for (const part of others) {
        lines.push(said(() => byName(text, part as string)) + " " + said(() => ofAnything(text, part)) + " " + said(() => byNameAt(text, part as string, 4)) + " " + said(() => ofAnythingAt(text, part, 0)) + " " + said(() => behindCallAt(text, part as string, 0)));
    }
}
console.log(lines.join("|"));
for (const receiver of [12, true, ["abcdef"], { toString() { return "abcdef"; } }, undefined, null] as unknown[])
    console.log(said(() => ofAnything(receiver, "ef")), said(() => ofAnythingAt(receiver, "ab", 0)), said(() => (String.prototype.startsWith as Function).call(receiver, "ef")), said(() => (String.prototype.startsWith as Function).call(receiver, "1", 0)));
const table: string[] = [];
for (const text of ["abcdef", "xabcdef", many]) for (const part of ["ab", "ef", "cd", "", "abcdef", many.slice(0, 32), many.slice(0, 33)]) for (const at of [-1, 0, 1, 4, 5, 6, 7, 8, 39, 40]) table.push(String(byNameAt(text, part, at)));
console.log(table.join(","));
const made: string[] = JSON.parse('["..abcdefabcdefabcdefabcdef..", "..ef..", "__abcdef__", "--ab--", "..cd", "aaaaaaaaaaaaaaaabaaaaaaaaaaaaaaaa", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "\u0100abcdef\u0100ef", "aaaaaaaaaaaaaaaabaaaaaaaaaaaaaaa"]');
const cuts: [number, number, number][] = [[0, 2, 26], [1, 2, 4], [2, 2, 8], [3, 2, 4], [4, 2, 4], [0, 2, 8], [0, 4, 6], [5, 0, 33], [5, 1, 33], [6, 0, 40], [6, 3, 36], [6, 0, 33], [7, 1, 7], [7, 8, 10], [2, 2, 2], [8, 0, 32], [6, 4, 36]];
const fresh: string[] = [];
for (const [textBase, textFrom, textTo] of cuts) {
    for (const [partBase, partFrom, partTo] of cuts) {
        fresh.push(String(byName(made[textBase].substring(textFrom, textTo), made[partBase].substring(partFrom, partTo))));
        fresh.push(String(ofAnything(made[textBase], made[partBase].substring(partFrom, partTo))));
        fresh.push(String(ofAnything(made[textBase].substring(textFrom, textTo), made[partBase])));
        fresh.push(String(byName(made[textBase].substring(textFrom, textTo) + made[3].substring(2, 4), made[partBase].substring(partFrom, partTo))));
        fresh.push(String(byName(made[textBase].substring(textFrom, textTo), made[partBase].substring(partFrom, partTo) + made[1].substring(2, 4))));
        for (const at of [-1, 0, 1, 2, 4, 5, 6, 7, 8, 22, 24])
            fresh.push(String(byNameAt(made[textBase].substring(textFrom, textTo), made[partBase].substring(partFrom, partTo), at)));
    }
}
console.log(fold(0, fresh.join(",")), fresh.length, fresh.slice(0, 64).join(","));
outside.push(byName, offLists, behindCall, ofAnything);
