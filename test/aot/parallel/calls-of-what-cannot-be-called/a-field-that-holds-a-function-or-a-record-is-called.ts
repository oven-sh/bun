namespace Tools {
    export function check(value: unknown): void { if (!value) throw new Error("no"); }
    export function first(x: number): number { return swaps() ? x + 1 : x; }
    function swaps(): boolean { (Tools as any).first = { level: 1 }; return false; }
}
function run(n: number): number { let t = 0; for (let i = 0; i < n; i++) { Tools.check(i >= 0); t += i; } return t; }
let said = String(run(5) + Tools.first(1));
try { Tools.first(1); } catch (e) { said += " " + (e as Error).constructor.name; }
console.log(said);
