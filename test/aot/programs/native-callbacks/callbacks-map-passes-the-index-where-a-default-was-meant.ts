// Callbacks handed over: map, forEach, filter, some and find pass (element, index, array), so a second parameter with a default gets a number and a third gets the array; the program's own calls pass one or two strings.
let total = 0;

function label(name: string, prefix: string = "p", suffix?: string): string {
  total += typeof prefix === "string" ? 1 : typeof prefix === "number" ? 100 : 10000;
  total += suffix === undefined ? 100000 : typeof suffix === "string" ? 1000000 : Array.isArray(suffix) ? 10000000 : 0;
  return prefix + name;
}

label("a");
label("b", "q", "s");
const names = ["x", "y"];
const callback = label as any;
const results: unknown[] = [names.map(callback), names.filter(callback).length, names.some(callback), names.find(callback), names.flatMap(callback), Array.from(names, callback), Array.from(new Set(names), callback)];
names.forEach(callback);
console.log(total, results.join());
