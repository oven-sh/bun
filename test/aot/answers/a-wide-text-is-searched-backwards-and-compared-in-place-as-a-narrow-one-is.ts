// answers: without-library
// # lastIndexOf, startsWith and endsWith answer as the methods do whatever the widths of the text and of what is sought: narrow, wide, wide though every character is narrow, joined and not yet written out; by value, on proven texts and for written texts; at every place around the sixteen and thirty-two characters that the quick searches step by
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 69 of 69 of 69
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function last(text: any, part: any, from: any) { return text.lastIndexOf(part, from); }
function lastOfAll(text: any, part: any) { return text.lastIndexOf(part); }
function begins(text: any, part: any, from: any) { return text.startsWith(part, from); }
function ends(text: any, part: any) { return text.endsWith(part); }
function lastInText(text: string, part: string, from: number) { return ("" + text).lastIndexOf("" + part, from | 0); }
function beginsInText(text: string, part: string, from: number) { return ("" + text).startsWith("" + part, from | 0); }
function endsInText(text: string, part: string) { return ("" + text).endsWith("" + part); }
function lastWritten(text: string, from: number) { const subject = "" + text, place = from | 0; return subject.lastIndexOf("b", place) * 7 + subject.lastIndexOf("ab", place) * 11 + subject.lastIndexOf("axb", place) * 13 + subject.lastIndexOf("a0123456789012345b", place) * 17 + subject.lastIndexOf("é", place) * 19 + subject.lastIndexOf("ů", place) * 23 + subject.lastIndexOf("", place) * 29; }
function filled(length: number, place: number, part: string) { let text = ""; for (let i = 0; i < length; i++) text += "ayb"[i % 3]; return place + part.length <= length ? text.slice(0, place) + part + text.slice(place + part.length) : text; }
function flat(text: string) { return JSON.parse(JSON.stringify(text)) as string; }
function widened(part: string) { return flat(part + "ů").slice(0, part.length); }
function mixed(sum: number, answer: number | boolean) { return (sum * 31 + Number(answer) + 2) % 1000003; }
const kinds: [string, (text: string) => string][] = [["narrow", text => flat(text)], ["wide behind", text => flat(text + "ů")], ["wide in front", text => flat("ů" + text)], ["wide though every character is narrow", text => widened(text)], ["joined and not yet written out", text => text.slice(0, text.length >> 1) + "" + text.slice(text.length >> 1) + (text.length > 20 ? "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy" : "")]];
const parts = ["", "a", "b", "ab", "axb", "a0123456789012345b", "é", "aé", "ů", "bů", "ůa", "a0123456789012345ů"];
const lengths = [0, 1, 2, 3, 15, 16, 17, 18, 31, 32, 33, 34, 40, 70];
function asked(name: string, made: (text: string) => string, part: string) { let byValue = 0, proven = 0, compared = 0, comparedProven = 0, calls = 0; for (const sought of [part, widened(part)]) { for (const length of lengths) { for (const place of [0, 1, length >> 1, length - part.length - 1, length - part.length]) { if (place < 0) continue; const text = made(filled(length, place, part)); byValue = mixed(byValue, lastOfAll(text, sought)); compared = mixed(compared, ends(text, sought)); comparedProven = mixed(comparedProven, endsInText(text, sought)); for (const from of [-1, 0, place - 1, place, place + 1, place + 2, length, length + 5]) { byValue = mixed(byValue, last(text, sought, from)); proven = mixed(proven, lastInText(text, sought, from)); compared = mixed(compared, begins(text, sought, from)); comparedProven = mixed(comparedProven, beginsInText(text, sought, from)); calls++; } } } } return name + " | " + JSON.stringify(part) + ": " + byValue + " " + proven + " " + compared + " " + comparedProven + " in " + calls; }
function askedForWritten(name: string, made: (text: string) => string) { let written = 0; for (const length of lengths) { for (const part of parts) { const text = made(filled(length, length >> 1, part)); for (const from of [-1, 0, 1, (length >> 1) - 1, length >> 1, (length >> 1) + 1, length, length + 5]) written = mixed(written, lastWritten(text, from)); } } return name + " | written texts: " + written; }
for (const [name, made] of kinds) { for (const part of parts) report(asked(name, made, part)); report(askedForWritten(name, made)); }
report(last("abcabc", "c", NaN) + " " + last("abcabc", "c", undefined) + " " + last("abcabc", "c", Infinity) + " " + last("abcabc", "c", -Infinity) + " " + last("abcabc", "a", -5) + " " + last("abcabc", "c", 4.9) + " " + last("abcabc", "c", "4"));
report(last("kůňkůň", "ů", NaN) + " " + last("kůňkůň", "k", 2) + " " + last("kůňkůň", "k", -5) + " " + last("kůňkůň", "ňk", 100) + " " + last("kůň", "u", 3));
report(ends("kůň", "ň") + " " + ends("kůň", "n") + " " + ends("kůň", "kůň") + " " + ends("kůň", "akůň") + " " + ends("kůňx", "x") + " " + begins("xkůň", "x", 0) + " " + begins("xkůň", "k", 1) + " " + begins("xkůň", "k", 2));
report("end");
