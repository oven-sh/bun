const n = (value: number) => Number(process.argv[8] ?? value);
let total: any = 0;
function add(list: any[]): void { for (let i = 0; i < list.length; i++) total += list[i]; }
(globalThis as any).kept = add;
add([1, 2, n(3)]); console.log(total); add([0.5, n(2147483647)]); console.log(total); add([1, "x", 2]); console.log(total); total = 1; add([1, , 3]); console.log(total); total = 10n; try { add([1]); } catch (error) { console.log((error as Error).constructor.name, total); }
