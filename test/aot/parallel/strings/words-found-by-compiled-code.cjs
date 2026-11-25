// Words that are one of a run-time pattern's, or share a place with one, are found by compiled code, narrow and wide, without a match by the engine.
// COUNT: counter:RegExpMatchesInterpreted <= 100
"use strict";
const list = "bread milk cumin porridge turmeric vinegar ox plum saffron jam marzipan ax barley pepper cream fig oat flour rice leek lamb honey watermelon carrot beet turnip ham pi corn";
const tastes = new RegExp(`^(?:${list.split(" ").join("|")})$`);
const others = list.split(" ").map(word => word[0] + word.slice(1, -1).toUpperCase() + word[word.length - 1]), text = list + " " + others.join(" ") + " spoon kettle Ā";
const words = text.split(" "), counts = [0, 0];
for (let i = 0; i < 1000; i++) for (const word of words) counts[tastes.test(word) ? 1 : 0]++;
const found = [];
for (const word of words) { const match = tastes.exec(word); if (match) found.push(match[0].length + match.index + (match.input === word)); }
tastes.test("bread"); const last = RegExp.lastMatch + RegExp.leftContext.length;
console.log(counts.join(), found.join(""), last);
