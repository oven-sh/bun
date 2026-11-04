// a switch stands behind a test that leaves its subject one value: a number, a text, -0 against 0, "2" against 2
function number(kind) { if (kind === 2) { switch (kind) { case 1: return "one"; case 2: return "two"; default: return "default"; } } return "outside"; }
function text(kind) { if (kind === "b") { switch (kind) { case "a": return "A"; case "b": return "B"; } return "behind"; } return "outside"; }
function zero(kind) { if (kind === 0) { switch (kind) { case 0: return "zero " + Object.is(kind, -0); default: return "default"; } } return "outside"; }
function absent(kind) { if (kind === 5) { switch (kind) { case 1: return "one"; case 2: return "two"; } return "fell out"; } return "outside"; }
const kinds = [1, 2, "2", 0, -0, "b", "a", 5, NaN, null, undefined, 2.0, new Number(2)];
for (let turn = 0; turn < 3; turn++) {
  for (let i = 0; i < kinds.length; i++)
    console.log(String(kinds[i]), number(kinds[i]), text(kinds[i]), zero(kinds[i]), absent(kinds[i]));
}
