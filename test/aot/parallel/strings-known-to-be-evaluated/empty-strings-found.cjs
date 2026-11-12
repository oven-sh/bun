// An empty string is found at the start of every string, also while the evaluated text is made.
function at() { return eval("(function () { return " + "xyz".indexOf("") + " + 10; })")(); }
function within() { return eval("(function () { return " + "xyz".includes("") + "; })")(); }
function inEmpty() { return eval("(function () { return [" + "".indexOf("") + ", " + "".includes("") + ", " + "".indexOf("a") + "]; })")(); }
function edges() { return eval("(function () { return [" + "xyz".startsWith("") + ", " + "xyz".endsWith("") + ", " + "xyz".indexOf("xyzx") + ", " + "xyz".indexOf("z") + "]; })")(); }
function chosen() { return eval("(function () { return " + ("ab".indexOf("") === 0 ? "'found'" : "'lost'") + "; })")(); }
function listed() { return eval("(function () { return '" + ["a", "b"].map(text => text + text.indexOf("")).join() + "'; })")(); }
function looped() { let text = ""; for (const part of ["a", "b", ""]) text += part.includes("") ? "1" : "0"; return eval("(function () { return '" + text + "'; })")(); }
function replaced() { return eval("(function () { return '" + "a-b".replace("-", "b".indexOf("")) + "a-b".repeat("a".includes("") ? 2 : 1) + "'; })")(); }
for (const f of [at, within, inEmpty, edges, chosen, listed, looped, replaced]) console.log(f.name, String(f()));
