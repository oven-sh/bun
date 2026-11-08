function tag(strings: TemplateStringsArray, ...values: number[]): string { let text = ""; for (let at = 0; at < strings.length; at++) text += strings[at] + (at < values.length ? values[at] * 2 : ""); return text + strings.raw.join("|") + strings.indexOf("b") + strings.includes("a") + strings.map(s => s.length).join() + Object.isFrozen(strings); }
let all = "";
for (let round = 0; round < 3; round++) all += tag`a${round}b${round + 1}c\n` + ";";
console.log(all);
