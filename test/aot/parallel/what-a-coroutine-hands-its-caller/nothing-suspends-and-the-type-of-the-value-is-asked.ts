const unseen: (i: number) => any = (0, eval)("(i) => ({ x: 41 + i })");
async function give(i: number) { return unseen(i); }
async function main() { let sum = 0; const said: string[] = []; for (let i = 0; i < 300; i++) { const got = await give(i); said.push(typeof got); sum += typeof got === "object" ? 1 : 0; } console.log(sum, said.slice(0, 4).join()); }
main();
