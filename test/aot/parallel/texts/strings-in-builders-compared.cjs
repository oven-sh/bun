"use strict";
// STATISTIC: BuilderLiteralComparisons >= 6
// STATISTIC: AppendedSumsOfUnknownValues >= 1
// A string that grows in a loop is compared with literals and switched over, and sums of unknown values are appended to strings.
function tokens(text) { let found = 0, token = ""; for (let i = 0; i < text.length; i++) { const c = text[i]; if (token == "RD" || token === "-|") { found += 7; token = ""; } else if (c === " ") { token = ""; } else { token += c; switch (token) { case "/CharString": found += 1; break; case "/Subrs": found += 20; break; case "/Blue": found += 400; break; case "q": found += 3; break; } } } return found + token; }
function lengths(text) { let found = 0, token = ""; for (let i = 0; i < text.length; i++) { if (text[i] === " ") { token = ""; continue; } token += text[i]; if (token === "a") found++; if (token === "ab") found += 2; if (token === "abc") found += 4; if (token === "abcd") found += 8; if (token == "abcde") found += 16; if (token === "abcdefg") found += 32; if (token === "abcdefgh") found += 64; if (token === "abcdefghi") found += 128; if (token === "abcdefghijklmnopq") found += 256; if (token === "\xe9\xff\x00\x80") found += 512; } return found + token; }
function long(text) { let found = 0, token = ""; for (let i = 0; i < text.length; i++) { token += text[i]; if (token === "xxxxxxxxxxxxxxxxxxxxxxx") found++; if (token === "xxxxxxxxxxxxxxxxxxxxxxxx") found += 10; if (token === "xxxxxxxxxxxxxxxxxxxxxxxxx") found += 100; if (token.length > 140) token = token.slice(0, 3); } return found + ":" + token.length; }
function wide(text) { let found = 0, token = ""; for (let i = 0; i < text.length; i++) { token += text[i]; if (token === "中") found += 1; if (token === "ab") found += 10; if (token === "ab中") found += 100; switch (token) { case "ab": found += 5; break; case "ab中": found += 50; token = ""; break; case "中": token = ""; break; } if (token.length > 4) token = ""; } return found + token; }
function pairs(list, key, text) { let result = ""; for (let i = 0; i + 1 < text.length; i++) { const a = text.charCodeAt(i) & 3, b = text.charCodeAt(i + 1) & 7; result += list[key][a] + list[key][b]; if (a === 2) result += list[key][b] + "=="; } return result; }
const pieces = ["RD", "/Subrs", "/CharStrings", "-|", "15", "/Blue", "q", "", "中", "ab中", "abcdefghijklmnopqr", "\xe9\xff\x00\x80", "abcdefgh", "x".repeat(40)];
let text = "", seed = 7;
for (let i = 0; i < 400; i++) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; text += pieces[seed % pieces.length] + (seed & 64 ? " " : ""); }
const answers = [];
const parts = [text, "", " ", "/Subrs", pieces.join(""), pieces.join(" "), text.slice(100, 500), "x".repeat(700), "RD RD -| abc ab a ", "abcdefghi abcdefgh abcdefg abcde abcd"];
for (const run of [tokens, lengths, long, wide]) for (const part of parts) answers.push(run(part));
const held = { strings: "ABCDEFGH".split(""), numbers: [1, 2, 3, 4, 5, 6, 7, 8], mixed: ["a", 1, "b", 2.5, null, undefined, true, "cc"], wide: ["中", "é", "", "x", "yy", "z", "文", "0"], objects: [{ toString() { answers.push("ran"); return "o"; } }, "p", 1, "q", [2, 3], "r", -0, "s"], holes: ["a", , "b", , "c", , "d", "e"], bigints: [1n, "2", 3n, "4", 5n, "6", 7n, "8"] };
for (const key of Object.keys(held)) for (const part of ["", "a", "ab", "hello, world", text.slice(0, 90)]) try { answers.push(pairs(held, key, part)); } catch (error) { answers.push(error.name); }
let sum = 0;
const all = answers.join("|");
for (let i = 0; i < all.length; i++) sum = (Math.imul(sum, 31) + all.charCodeAt(i)) | 0;
console.log(all.length, sum, answers[0], answers[10], answers[20], answers[30]);
console.log(all.slice(0, 1200));
