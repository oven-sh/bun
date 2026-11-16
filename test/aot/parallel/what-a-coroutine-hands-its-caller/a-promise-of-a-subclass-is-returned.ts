class Mine<T> extends Promise<T> { then(a: any, b: any): any { return super.then((v: any) => a({ x: v.x * 2 }), b); } }
async function give(i: number) { return Mine.resolve({ x: i }); }
async function main() { let sum = 0; const said: string[] = []; for (let i = 0; i < 300; i++) { const got: any = await give(i); sum += got.x; } console.log(sum, said.slice(0, 4).join()); }
main();
