function kept(strings) { return strings.raw.filter(text => text !== "").length; }
function mapped(strings, ...values) { const list = strings; const raw = list.raw; return raw.map(text => text + values.length).join("|") + strings.length; }
function found(text) { const match = /(?<first>\w)(\d)/d.exec(text); return match ? [match.index, match.input.length, match.groups.first, match.indices[0].map(n => n + 1).join()].join() : "none"; }
function counted() { return Array.prototype.map.call(arguments, x => x + arguments.length).join(); }
function told(error) { return [error.message.toUpperCase(), typeof error.stack, error.cause?.map?.(x => x + 1)?.join()].join(); }
function read(value) { return String(value.raw?.map?.(x => x + "!").join()) + String(value.index) + String(value.other); }
for (let i = 0; i < 4; i++) {
  console.log(kept`a${1}b${2}`, mapped`x${1}\n${i}y`, found("q" + "ab1c".slice(i)), counted(i, 2), told(new Error("e" + i, { cause: [i] })));
  console.log([[1, 2], (s => s)`p${i}q`, /b/.exec("abc"), "text", i, true, { raw: [i], index: 2 }, new Map(), () => 1].map(read).join(" "));
}
const aggregate = new AggregateError([1, 2], "two");
console.log(aggregate.errors.map(x => x * 2).join(), [...'a1b2'.matchAll(/\d/g)].map(match => match.index + match.input.length).join());
