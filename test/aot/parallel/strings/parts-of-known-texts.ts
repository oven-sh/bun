// The parts of texts that the program spells, by every way of asking for them and every kind of bound.
const lines: string[] = [];
const texts = ["", "a", "bravo", "wide é text", "日本語のテキスト", "a😀b"];
function show(name: string, value: unknown) {
  lines.push(name + ": " + JSON.stringify(value));
}
const zero = lines.length & 0;
show("slice whole", "bravo".slice(zero));
show("slice 1", "bravo".slice(1));
show("slice 1 3", "bravo".slice(1, 3));
show("slice -2", "bravo".slice(-2));
show("slice -2 -1", "bravo".slice(-2, -1));
show("slice 3 1", "bravo".slice(3, 1));
show("slice beyond", "bravo".slice(9));
show("slice 0 99", "bravo".slice(0, 99));
show("slice -99", "bravo".slice(-99));
show("slice undefined", "bravo".slice(undefined, undefined));
show("slice fraction", "bravo".slice(1.9, 3.9));
show("slice NaN", "bravo".slice(NaN));
show("slice -0", "bravo".slice(-0));
show("slice Infinity", "bravo".slice(1, Infinity));
show("slice -Infinity", "bravo".slice(-Infinity, 2));
show("substring 1 3", "bravo".substring(1, 3));
show("substring 3 1", "bravo".substring(3, 1));
show("substring -2", "bravo".substring(-2));
show("substring 2 -1", "bravo".substring(2, -1));
show("substring 99", "bravo".substring(99));
show("substr 1 2", "bravo".substr(1, 2));
show("substr -2 1", "bravo".substr(-2, 1));
show("charAt 1", "bravo".charAt(1));
show("at -1", "bravo".at(-1));
show("wide slice", "日本語のテキスト".slice(1, 3));
show("pair half", "a😀b".slice(1, 2).charCodeAt(0));
show("pair whole", "a😀b".slice(1, 3));
show("latin1", "wide é text".slice(5, 6));
show("empty", "".slice(zero));
show("join", "bra" + "vo".slice(zero));
const dict: Record<string, number> = { alpha: 1, bravo: 2, charlie: 3 };
show("key", dict["bra" + "vo".slice(zero)]);
show("key missing", dict["bra" + "vo".slice(1)]);
const replaced = "bravo".slice(zero) === "bravo";
show("same", replaced);
// The same, where nothing is known until the program runs.
for (const text of texts)
  show("at run time " + text, [text.slice(1), text.slice(-1), text.slice(1, 2), text.substring(2, 1), text.length]);
for (const start of [zero, 1, -1, 99]) show("start " + start, ["bravo".slice(start), "bravo".substring(start)]);
console.log(lines.join("\n"));
