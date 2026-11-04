// A for-in is left by every way, and the key of the last turn is read behind the loop.
function byBreak(o) { var k; for (k in o) { if (o[k] === 2) break; } return k + "=" + o[k]; }
function byContinue(o) { let text = ""; for (const k in o) { if (o[k] === 2) continue; text += k; } return text; }
function byReturn(o) { for (const k in o) { if (o[k] === 2) return k + "=" + o[k]; } return "none"; }
function byThrow(o) { try { for (const k in o) { if (o[k] === 2) throw new Error(k); } } catch (e) { return e.message; } return "none"; }
function byLabel(o) { let text = ""; outer: for (const k in o) { for (const j in o) { if (j === "b") continue outer; text += k + j + " "; } } return text; }
function deed(o) { return [byBreak(o), byContinue(o), byReturn(o), byThrow(o), byLabel(o)].join(" | "); }
console.log(deed({ a: 1, b: 2, c: 3 }));
for (let i = 0; i < 3; i++) console.log(deed({ a: 1, b: 2, c: 3 }), "#", deed({ x: 9 }), "#", deed({}));
