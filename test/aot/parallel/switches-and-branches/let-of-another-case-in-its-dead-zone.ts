// a let that one case declares is read by a later case, which a run may enter without passing the declaration
function subject(v: number) { switch (v) { case 1: let held = "set"; return held; case 2: try { return held!; } catch (e) { return (e as Error).name; } case 3: break; default: held = "late"; return held; } return "three"; }
function deed(v: number) { try { return subject(v); } catch (e) { return "out:" + (e as Error).name; } }
let text = "";
for (let v = 0; v < 5; v++) text += deed(v) + ";";
console.log(text);
text = "";
for (let turn = 0; turn < 3; turn++) for (let v = 3; v > 0; v--) text += deed(v) + ";";
console.log(text);
