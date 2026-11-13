const unseen: (i: number) => any = (0, eval)("(i) => ({ x: 41 + i })");
async function give(i: number) { await null; return unseen(i); }
async function main() { let sum = 0; const said: string[] = []; for (let i = 0; i < 300; i++) { const got = await give(i); sum += got === undefined ? 0 : got.x; } console.log(sum, said.slice(0, 4).join()); }
main();
