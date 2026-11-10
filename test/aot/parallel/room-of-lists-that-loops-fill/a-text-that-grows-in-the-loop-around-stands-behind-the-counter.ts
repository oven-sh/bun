function rows(n: number): string { let text = ""; let c = 0; for (let r = 0; r < n; r++) { text += "ab"; const out: string[] = []; for (let at = 0; at < 9; at++) out.push(at + text); c += out.length; } return text.length + ":" + c; }
console.log(rows(JSON.parse("2")));
export {};
