const ages = new Map<string, number>([["ann", 31], ["bob", 27]]);
const seen = new Set<string>(["ann"]);
const notes = new WeakMap<object, number>();
Object.preventExtensions(ages); Object.preventExtensions(seen); Object.preventExtensions(notes);
const key = {};
function step(name: string, round: number): string { ages.set(name, (ages.get(name) ?? 0) + round); seen.add(name + round % 2); notes.set(key, round); return [ages.get(name), ages.has("bob"), ages.size, seen.has(name), seen.size, notes.get(key), notes.has(key)].join(); }
let all = "";
for (let round = 0; round < 4; round++) all += step(round % 2 ? "ann" : "cy", round) + ";";
for (const [name, age] of ages) all += name + age;
for (const name of seen) all += name;
all += [...ages.keys()].join() + [...seen].length + ages.delete("bob") + seen.delete("ann");
console.log(all);
