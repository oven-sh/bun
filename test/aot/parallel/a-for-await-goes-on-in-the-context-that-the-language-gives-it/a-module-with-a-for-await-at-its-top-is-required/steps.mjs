async function* body() { await null; als.enterWith("g"); yield 1; yield 2; }
export const seen = [];
for await (const x of body()) seen.push(x + String(als.getStore()));
log.push("steps " + String(als.getStore()), seen.join(","));
console.log(log.join("\n"));
