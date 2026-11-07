const log: string[] = []; let counter = 0;
function counted(values: unknown[]): any { let at = 0; return { [Symbol.iterator]() { return { next() { counter++; log.push("next"); return at < values.length ? { done: false, value: values[at++] } : { done: true, value: undefined }; }, return() { log.push("return"); return {}; } }; } }; }
function readsVariable(pair: any): string { const [first = counter, second = counter] = pair; return first + "," + second; }
function calls(pair: any): string { const [first = (log.push("default"), 1), second] = pair; return first + "," + second; }
function throwsInDefault(pair: any): string { try { const [first = (() => { throw new RangeError("of the default"); })(), second] = pair; return first + "," + second; } catch (error) { return (error as Error).message; } }
function changesList(list: any[]): string { const [first = list.push(50), second, third] = list; return first + "," + second + "," + third; }
let out = ""; for (let round = 0; round < 30; round++) { counter = 0; out = readsVariable(counted([undefined, undefined, 3])) + " " + calls(counted([undefined, 2, 3])) + " " + throwsInDefault(counted([undefined, 2])) + " " + changesList([undefined, 2]) + " " + log.join(); log.length = 0; } console.log(out);
