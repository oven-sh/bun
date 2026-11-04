// the loop waits in a turn, and the code that goes on meanwhile cuts the list and fills it anew with fractions
async function sum(list: number[], at: number): Promise<number> { let s = 0; for (let i = 0; i < list.length && i < 30; i++) { s += list[i]; if (i === at) await null; } return s; }
(globalThis as any).kept = sum;
const subject = (globalThis as any).kept as typeof sum;
function fresh(): number[] { return JSON.parse("[1,2,3,4,5,6]"); }
async function deed(at: number): Promise<number> { const list = fresh(); const waiting = subject(list, at); list.length = 1; for (let k = 0; k < 12; k++) list.push(k + 0.5); return await waiting; }
async function main() {
    console.log(String(await subject(fresh(), 99)));
    let all = 0;
    for (let turn = 0; turn < 200; turn++) all += await deed(turn % 7);
    console.log(String(all));
    console.log(String(await deed(2)));
    console.log(String(await deed(99)));
}
main();
