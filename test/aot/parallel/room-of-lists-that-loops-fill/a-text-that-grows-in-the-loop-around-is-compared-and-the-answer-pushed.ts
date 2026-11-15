function flags(rows: number): string { let text = ""; let n = 0; for (let r = 0; r < rows; r++) { text += "ab"; const out: boolean[] = []; for (let at = 0; at < 9; at++) out.push(text === "abab"); for (const f of out) if (f) n++; } return text.length + ":" + n; }
console.log(flags(JSON.parse("3")));
export {};
