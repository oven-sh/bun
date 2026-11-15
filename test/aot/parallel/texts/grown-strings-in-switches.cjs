"use strict";
// STATISTIC: BuilderSwitchLengthChecks >= 2
// A string that grows by a character is switched over in each iteration: cases of one length, of several, with the empty string and wide characters among them.
function names(text) { let found = 0, token = ""; for (let i = 0; i < text.length; i++) { const c = text[i]; if (c === " ") { token = ""; continue; } token += c; switch (token) { case "/CharString": found += 1; break; case "/Subrs": found += 20; break; case "/BlueValues": found += 400; break; } } return found + token; }
function ends(text) { let found = "", token = "a"; outer: for (let i = 0; i < text.length; i++) { const c = text[i]; if (c === " " || c === "\n") { switch (token) { case "": break; case "dup": found += "d"; token = ""; continue outer; case "RD": case "-|": found += "r" + i; break; default: if (token[0] >= "0" && token[0] <= "9") token = parseInt(token, 10); found += token; } token = ""; } else token += c; } return found + "|" + token; }
function wide(text) { let found = 0, token = ""; for (let i = 0; i < text.length; i++) { token += text[i]; switch (token) { case "中": found += 1; break; case "中文": found += 10; token = ""; break; case "ab中": found += 100; default: found += 1000; } if (token.length > 4) token = ""; } return found + token; }
function one(text) { let found = 0, token = ""; for (let i = 0; i < text.length; i++) { token += text[i]; switch (token) { case "abc": found++; token = ""; break; case "abd": return -found; default: if (token.length === 3) token = token.slice(1) && ""; } } return found; }
function kept(text) { const all = []; let token = ""; for (let i = 0; i < text.length; i++) { token += text.charAt(i); switch (token) { case "if": case "else": all.push(token); token = ""; break; case "return": all.push(token + "!"); token = ""; } } return all.join() + token; }
const pieces = ["dup", "/Subrs", "/CharStrings", "RD", "15", "/BlueValues", "-|", "", "中文", "ab中", "abc", "abd", "ifelsereturnif", "x".repeat(40)];
let text = "", seed = 7;
for (let i = 0; i < 400; i++) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; text += pieces[seed % pieces.length] + (seed & 64 ? " " : ""); }
const answers = [];
for (const run of [names, ends, wide, one, kept]) for (const part of [text, "", " ", "/Subrs", pieces.join(""), pieces.join(" ") + "\n", text.slice(100, 500)]) answers.push(run(part));
let sum = 0;
const all = answers.join("|");
for (let i = 0; i < all.length; i++) sum = (Math.imul(sum, 31) + all.charCodeAt(i)) | 0;
console.log(all.length, sum, answers[0], answers[7]);
