// a switch over integers is asked with -0, NaN, fractions, texts of digits, a BigInt, a boolean and an object that converts: strict equality finds the case
function subject(v: unknown) { switch (v) { case 0: return "zero"; case 1: return "one"; case 2: break; case 3: return "three"; default: return "rest"; } return "two"; }
function typed(v: number) { switch (v) { case 0: return "zero"; case 1: return "one"; case 2: break; case 3: return "three"; default: return "rest"; } return "two"; }
function deed(v: unknown) { return subject(v) + (typeof v === "number" ? typed(v) : ""); }
const values: unknown[] = [0, -0, 1, 2, 3, 4, NaN, 1.5, 2 ** 32 + 1, -1, Infinity, "1", "", 1n, true, null, undefined, { valueOf() { return 1; } }, [1]];
let text = "";
for (let i = 0; i < values.length; i++) text += deed(values[i]) + ";";
console.log(text);
text = "";
for (let turn = 0; turn < 3; turn++) for (let i = 0; i < 6; i++) text += deed(i - 1) + ";";
console.log(text);
