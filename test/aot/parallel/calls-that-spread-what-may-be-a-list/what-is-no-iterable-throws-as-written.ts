// What cannot be spread throws what plain throws, and nothing behind it runs.
function two(a: any, b: any) { return String(a) + "," + String(b); }
const log: string[] = [];
const sources: any[] = [[1, 2], null, undefined, 5, {}, true, Symbol.iterator, { [Symbol.iterator]: 1 }, { [Symbol.iterator]() { return {}; } }, { [Symbol.iterator]() { return { next() { throw new Error("from next"); } }; } }, [3, 4]];
for (let i = 0; i < sources.length; i++) {
  try { log.push(i + " " + two(...(sources[i] as [any, any]))); } catch (e: any) { log.push(i + " " + e.constructor.name + " " + (e.message === "from next")); }
}
console.log(log.join("\n"));
