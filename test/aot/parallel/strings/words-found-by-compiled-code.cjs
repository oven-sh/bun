// Words that are one of a run-time pattern's, or share a place with one, are found by compiled code, narrow and wide, without a match by the engine.
// COUNT: counter:RegExpMatchesInterpreted <= 100
"use strict";
const list = "break case catch continue debugger default do else finally for function if return switch throw try var while with null true false instanceof typeof void delete new in this";
const keywords = new RegExp("^(?:" + list.replace(/ /g, "|") + ")$");
const others = list.split(" ").map(word => word[0] + word.slice(1, -1).toUpperCase() + word[word.length - 1]), text = list + " " + others.join(" ") + " identifier value Ā";
const words = text.split(" "), counts = [0, 0];
for (let i = 0; i < 1000; i++) for (const word of words) counts[keywords.test(word) ? 1 : 0]++;
const found = [];
for (const word of words) { const match = keywords.exec(word); if (match) found.push(match[0].length + match.index + (match.input === word)); }
keywords.test("break"); const last = RegExp.lastMatch + RegExp.leftContext.length;
console.log(counts.join(), found.join(""), last);
