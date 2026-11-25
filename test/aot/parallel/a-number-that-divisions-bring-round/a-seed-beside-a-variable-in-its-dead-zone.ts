function run(x: number, n: number): number { for (let i = 0; i < n; i++) x = (x * 3 + late) % 16; return x; }
function tell(x: number, n: number): string { try { return String(run(x, n)); } catch (e) { return (e as Error).name; } }
console.log(tell(5, 0), tell(5, 1));
let late = 1;
console.log(tell(5, 2), tell(0.5, 2), tell(-1, 1));
