"use strict";
// STATISTIC: LoopsBuiltForListsAndForTexts >= 3
// `s[i] === ","` and `s.length` say "a text or a list". Where the callers are out of sight the guard tested for a list, a text failed it and the slow version ran. The loop asks in front which of the two it is.
const key = JSON.parse('"go"');
const count = { go(s) { let c = 0; for (let i = 0; i <= s.length; i++) if (s[i] === ",") c++; return c; } };
const range = { go(s) { let c = 0; for (let i = 0; i < s.length; i++) if (s[i] >= "a" && s[i] <= "f") c++; return c; } };
const kept = { go(s) { let out = ""; for (let i = 0; i < s.length; i++) { const h = s[i]; if (h !== "," && h != "b") out += h; } return out; } };
const given = [JSON.parse('"ab,cd,,\\u00e9\\ud83d\\ude00,"'), "", ",", "a".repeat(40) + ",", ("x,".repeat(20) + "y").slice(1), JSON.parse('["a",",","bc",","]'), JSON.parse('[1,",",null,true,["a"],{"b":1}]'), [",", , ","], [], new String("a,b"), { length: 3, 0: ",", 1: "a", 2: "," }, new Uint8Array([44, 97]), Buffer.from("a,b"), Object.freeze([",", "f"]), [{ toString() { return ","; } }, { valueOf() { return "c"; } }]];
for (const s of given) for (let turn = 0; turn < 3; turn++) { let said; try { said = count[key](s) + " " + range[key](s) + " " + String(kept[key](s)); } catch (e) { said = e.name; } console.log(said); }
