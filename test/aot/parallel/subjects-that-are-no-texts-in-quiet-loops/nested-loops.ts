// What is printed is what plain Bun prints.
const log: string[] = []; const turns: number[] = []; function talker(name: string, text: string) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { toString() { log.push(name); return text; } }; }
function read(rows: string[][]) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; let n = 0; for (let r = 0; r < rows.length; r++) { turns.push(r); const row = rows[r]; for (let i = 0; i < row.length; i++) { const m = /^([a-z]+)=(.*)$/.exec(row[i]); if (m) n += m[1].length; else n += 100; } } return n; }
console.log(read([["a=1", talker("R0", "bb=2")], [talker("R1", "c=3"), "dd=4"]] as unknown as string[][]), log.join(","), turns.join(","));
