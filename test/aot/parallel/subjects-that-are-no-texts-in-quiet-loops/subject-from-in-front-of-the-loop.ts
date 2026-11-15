// What is printed is what plain Bun prints.
const log: string[] = []; function talker(name: string, text: string) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { toString() { log.push(name); return text; } }; }
function read(re: RegExp, text: string) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; let n = 0; let m: RegExpExecArray | null; while ((m = re.exec(text)) !== null) n += m[1].length; return n; }
console.log(read(/([a-z]+)=/g, talker("W", "a=;bb=;ccc=") as unknown as string), log.join(","));
