// the cases of a switch lie far apart, and tests in front of it have ruled some of them out: each value that is left finds its case
function subject(v: number) { if (v < 0) return "negative"; if (v > 1000000) return "large"; switch (v) { case -5: return "never"; case 0: return "zero"; case 7: return "seven"; case 1000000: return "million"; case 2000000: return "never"; default: return "rest"; } }
function bits(v: number) { switch (v & 3) { case 0: return "a"; case 1: return "b"; case 2: return "c"; case 3: return "d"; case 4: return "never"; default: return "rest"; } }
function kinds(v: string | number | null) { if (typeof v === "string") { switch (v as unknown) { case 1: return "never"; case "1": return "text"; default: return "other text"; } } switch (v) { case null: return "null"; case 1: return "one"; default: return "other"; } }
function deed(v: number) { return subject(v) + bits(v) + kinds(v) + kinds(String(v)) + kinds(v ? v : null); }
const values = [-5, -1, 0, 1, 7, 8, 999999, 1000000, 1000001, 2000000, 0.5, NaN, -0];
let text = "";
for (let i = 0; i < values.length; i++) text += deed(values[i]) + ";";
console.log(text);
text = "";
for (let turn = 0; turn < 3; turn++) for (let v = 0; v < 9; v++) text += deed(v) + ";";
console.log(text);
