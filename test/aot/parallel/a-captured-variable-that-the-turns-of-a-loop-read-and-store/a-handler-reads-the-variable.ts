const n = (value: number) => Number(process.argv[8] ?? value);
function make(text: string) { let pos = 0; return { run() { try { while (pos < 100) { if (text.charCodeAt(pos) !== text.charCodeAt(pos)) throw new Error("end"); pos++; } } catch (error) { return (error as Error).message + pos; } return "none" + pos; }, outer() { while (pos < 100) { if (pos === n(7)) throw new Error("seven"); pos++; } }, get: () => pos, set(to: number) { pos = to; } }; }
const m = make("abcde".repeat(n(2)));
console.log(m.run(), m.get()); m.set(0);
try { m.outer(); } catch (error) { console.log((error as Error).message, m.get()); }
