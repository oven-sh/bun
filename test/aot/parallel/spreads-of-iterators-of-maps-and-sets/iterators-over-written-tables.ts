const prices = new Map<string, number>([["ale", 3], ["bun", 4], ["cod", 5]]), names = new Set<string>(["ale", "bun", "cod"]);
function all(values: any): string { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; return ["<", ...values, ">"].join(" "); }
const said: string[] = [], early = prices.values(), earlyKeys = prices.keys(), earlyNames = names.values();
said.push(all(prices.keys()), all(prices.values()), all(names.values()), all(names.keys()));
prices.delete("ale"); prices.set("dab", 6); names.delete("ale"); names.add("dab");
said.push(all(early), all(earlyKeys), all(earlyNames), all(early), String(early.next().done));
console.log(`SAID ${said.join(" | ")}`); export {};
