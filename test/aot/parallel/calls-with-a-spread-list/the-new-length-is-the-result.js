// `list.push(a, ...other)`: the call answers the new length, where it is read, returned, compared or dropped.
function length(source) { const out = ["w"]; const n = out.push("a", ...source); return n + " " + out.length; }
function returned(source) { const out = []; return out.push(...source); }
function compared(source) { const out = []; if (out.push(1, ...source) > 2) return "many " + out.length; return "few " + out.length; }
function dropped(source) { const out = []; void out.push(1, ...source); out.push(...source), out.push(2, ...source); return out.length; }
for (const source of [[], [1], [1, 2, 3]]) console.log(length(source), returned(source), compared(source), dropped(source));
