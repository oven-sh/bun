const subjects: string[] = (JSON.parse('["", "a", ":", "a:b", "::", "alpha:beta:gamma", "no delimiter here", "\\u00e9t\\u00e9:\\u00ff", "\\u0416:\\u0416", "tail:"]') as string[]).concat(["x".repeat(31) + ":", "x".repeat(32) + ":", "x".repeat(33) + ":", "x".repeat(300) + ":" + "y".repeat(300), ("left" + Math.abs(-1)) + (":right" + Math.abs(-2)), "0123456789:".slice(3), "ab:cd".substring(1, 4)]);
const needles: string[] = (JSON.parse('["", ":", "a", "\\u00ff", "\\u00e9", "\\u0416", "::", "a:", "x", "y", "\\u0000", "delimiter", "1"]') as string[]).concat([String.fromCharCode(58), ":;".slice(0, 1), "a" + ""]);
const starts: number[] = [0, 1, 2, 3, -1, 31, 32, 33, 34, 300, 301, 302, 601, 602, 2147483647, -2147483648];
function find(subject: string, needle: string, start: number): number { return subject.indexOf(needle, start); }
function has(subject: string, needle: string, start: number): boolean { return subject.includes(needle, start); }
function count(subject: string, needle: string): number { let n = 0; for (let at = subject.indexOf(needle); at >= 0 && n < 1000; at = subject.indexOf(needle, at + 1)) n++; return n; }
const said: string[] = [];
for (const subject of subjects) for (const needle of needles) { let row = ""; for (const start of starts) row += find(subject, needle, start) + (has(subject, needle, start) ? "+" : "-"); said.push(row + count(subject, needle)); }
console.log(said.join("\n"));
