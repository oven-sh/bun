// Words that are none of a run-time pattern's are told apart by compiled code, without a match by the engine.
// COUNT: counter:RegExpMatchesInterpreted <= 4000
"use strict";
const tastes = new RegExp(`^(?:${"bread milk cumin porridge turmeric vinegar ox plum saffron jam marzipan ax barley pepper cream fig oat flour rice leek lamb honey".split(" ").join("|")})$`);
const text = "spoon fork knife plate bowl ladle kettle cup saucer tray jug pot lid pan whisk grater sieve funnel barley ax";
const words = text.split(" "), counts = [0, 0];
for (let i = 0; i < 1000; i++) for (const word of words) counts[tastes.test(word) ? 1 : 0]++;
console.log(counts.join());
