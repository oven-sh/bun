import * as fs from "node:fs";
const wanted = JSON.parse('["promises","readFileSync","nothing"]');
for (const word of wanted) console.log(word, word in fs);
console.log("end");
