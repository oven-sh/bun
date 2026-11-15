const handlers: Array<(n: number) => number> = [];
function add(f: (n: number) => number): number { handlers.push(f); return handlers.indexOf(f); }
function remove(f: (n: number) => number): boolean { const at = handlers.indexOf(f); if (at < 0) return false; handlers.splice(at, 1); return true; }
const double = (n: number) => n * 2;
console.log(add(double), add(n => n + 1), handlers.includes(double), remove(double), remove(double), remove(n => n + 1), handlers.length);
