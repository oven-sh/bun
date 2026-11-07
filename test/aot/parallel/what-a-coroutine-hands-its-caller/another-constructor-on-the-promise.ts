async function give(i: number) { return { x: i }; }
async function main() { let sum = 0; const said: string[] = []; for (let i = 0; i < 300; i++) { const promise: any = give(i); if (i & 1) promise.constructor = function Other() { }; const got = await promise; sum += got.x; } console.log(sum, said.slice(0, 4).join()); }
main();
