// Array.prototype.toLocaleString hands its two arguments to each element's toLocaleString, which converts what they contain to strings: a toString method of an object in the list of locales, and one of an object in the options, are both called.
const trace: string[] = [];
const locale = { toString() { trace.push("locale"); return "en-US"; } };
const style = { toString() { trace.push("style"); return "percent"; } };
function format(list: number[]): string { return list.toLocaleString([locale] as any, { style } as any); }
console.log(format([1, 2]), trace.join());
export {};
