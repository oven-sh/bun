// What is printed is what plain Bun prints.
const log: string[] = []; class Talker { text: string; constructor(text: string) { this.text = text; } toString() { log.push(this.text); return this.text; } }
function read(turns: number) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const t = new Talker("a=1"); let n = 0; for (let i = 0; i < turns; i++) { const m = /^([a-z]+)=(.*)$/.exec(t as unknown as string); if (m) n += m[1].length; } return n; }
console.log(read(JSON.parse("3")), log.join(","));
