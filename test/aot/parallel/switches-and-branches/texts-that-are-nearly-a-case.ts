// a switch over texts is asked with a rope, a piece of a longer text, a 16-bit text, a String object and a number: strict equality finds the case
function subject(v: unknown) { switch (v) { case "alpha": return "first"; case "beta": break; case "Āda": return "wide"; case "": return "empty"; case "1": return "digit"; default: return "rest"; } return "second"; }
function deed(v: unknown) { return subject(v); }
let rope = "al";
rope += "pha";
const piece = "xxbetaxx".slice(2, 6);
const wide = "Ā" + "da";
const values: unknown[] = ["alpha", rope, "beta", piece, wide, "Ada", "", 1, "1", new String("alpha"), null, undefined, ["beta"], "alph", "alphaa"];
let text = "";
for (let i = 0; i < values.length; i++) text += deed(values[i]) + ";";
console.log(text);
text = "";
for (let turn = 0; turn < 3; turn++) { let grown = ""; for (const letter of "beta") grown += letter; text += deed(grown) + ";"; }
console.log(text);
