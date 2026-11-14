let calls = 0;
let list: any[] = [];
const bad: any = { valueOf() { list.length = 0; return 7; }, toString() { list.length = 0; return "7"; } };
function test(code: number): boolean { return (code | 0) > 3; }
function walk(items: any[]): number { let n = 0; for (const x of items) { if (x > 2 && test(x === 4 ? bad : x)) n++; n += Number(x) || 0; } return n; }
for (const start of [[1, 2, 3, 4, 5, 6, 7, 8], [4, 4, 4], [1.5, 2.5, 4, 8.5], [3, 5, 7], []]) {
  for (let round = 0; round < 3; round++) {
    calls = 0;
    list = start.slice();
    let said: any;
    try { said = walk(list); } catch (error: any) { said = error.name; }
    console.log(said, list.length, JSON.stringify(list), calls);
  }
}
for (let round = 0; round < 50; round++) { list = [1, 2, 3, 5, 6, 7]; calls = 0; console.log(walk(list), list.length); }
export {};
