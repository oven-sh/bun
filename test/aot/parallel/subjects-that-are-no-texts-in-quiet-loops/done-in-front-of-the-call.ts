// What is printed is what plain Bun prints.
const log: string[] = []; const turns: number[] = []; let steps = 0; function talker(name: string, text: string) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { toString() { log.push(name); return text; } }; }
function read(list: string[]) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; let n = 0; for (let i = 0; i < list.length; i++) { steps++; turns.push(i); const m = /^([a-z]+)=(.*)$/.exec(list[i]); if (m) n += m[1].length; } return n; }
console.log(read(["a=1", talker("T1", "bb=2"), "c=3"] as unknown as string[]), steps, log.join(","), turns.join(","));
