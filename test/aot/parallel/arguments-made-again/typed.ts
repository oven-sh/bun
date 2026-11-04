const unseen = (0, eval)("(x) => x");
const sink: { apply(self: unknown, list: IArguments): string } = unseen({ apply(self: unknown, list: IArguments) { return list.length + ":" + Array.prototype.join.call(list, ","); } });
function wrap(first: string, ...others: string[]): string { others.push("added"); return sink.apply(null, arguments); }
function shrink(first: number, ...others: number[]): string { others.length = 0; return sink.apply(null, arguments); }
let last = "";
for (let i = 0; i < 300; i++) last = wrap("a", "b", "c") + " " + shrink(1, 2, 3, 4, 5, 6, 7, 8);
console.log(last);
