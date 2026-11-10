const unseen = (x: any): any => [x][JSON.parse("0")];
function renamed(first: any, later: any, go: boolean): string { let held = first; let said = ""; if (held && go) said += "1"; held = later; if (held && go) said += "2"; return said + "|"; }
function inTurns(list: any[], go: boolean): string { let said = ""; for (let i = 0; i < list.length; i++) { const held = list[i]; if (held && go) { said += "a"; if (i & 1) continue; } if (held && !go) said += "b"; else said += "c"; } return said; }
const kinds = [undefined, {}, 0, "x", null, [], false];
let all = "";
for (const a of kinds) for (const b of kinds) all += Reflect.apply(renamed, undefined, [unseen(a), unseen(b), true]);
console.log(all, Reflect.apply(inTurns, undefined, [unseen(kinds), true]), Reflect.apply(inTurns, undefined, [unseen(kinds), false]));
