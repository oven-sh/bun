function parts(text: string): string { const found = text.match(/(\d+)-(\d+)/); if (!found) return "none"; let sum = ""; for (let at = 0; at < found.length; at++) sum += found[at] + "/"; return sum + found.index + found.indexOf("12") + found.includes("7") + found.join("+") + found.slice(1).length + [...found].length; }
let all = "";
for (const text of ["a 12-7 b", "none", "3-44", "12-12"]) all += parts(text) + ";";
const every = "1a2b3c".matchAll(/\d/g);
for (const one of every) all += one[0] + one.index + one.length + one.join("");
const exec = /(?<word>[a-z]+)/.exec("  hello ")!;
all += exec.groups!.word + exec.length + exec.map(x => x.length).join() + exec.lastIndexOf("hello");
console.log(all);
