const log: string[] = [];
async function* g(): any { try { yield* [Promise.resolve(1), 2]; yield* { [Symbol.iterator]() { let i = 0; return { next(...a: any[]) { log.push("n" + a.length + String(a[0])); return { done: i === 2, value: i++ }; }, return(v: any) { log.push("r" + v); return { done: true, value: v }; } }; } } as any; } finally { log.push("f"); } }
async function main() { const it = g(); for (const sent of ["a", "b", "c", "d"]) { const r = await it.next(sent); log.push(String(r.value) + r.done); } log.push(JSON.stringify(await it.return("z"))); console.log(log.join(" ")); }
main();
