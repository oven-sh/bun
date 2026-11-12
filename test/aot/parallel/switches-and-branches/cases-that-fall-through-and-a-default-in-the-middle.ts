// cases fall through, some are empty, and the default stands in the middle: an empty case goes where its neighbor goes, and not where the rest goes
function subject(v: number) { let seen = ""; switch (v) { case 1: case 2: seen += "low"; case 3: break; default: seen += "rest"; case 4: seen += "four"; break; case 5: } return seen + "."; }
function empty(v: number) { let seen = "none"; switch (v) { case 1: break; case 2: break; default: break; } return seen; }
function onlyDefault(v: number) { let seen = "none"; switch (v) { case 1: break; default: seen = "rest"; } return seen; }
function deed(v: number) { return subject(v) + empty(v) + onlyDefault(v); }
let text = "";
for (let v = 0; v < 8; v++) text += deed(v) + ";";
console.log(text);
text = "";
for (let turn = 0; turn < 3; turn++) for (let v = 5; v > 0; v--) text += deed(v) + ";";
console.log(text);
