// STATISTIC: ConstantsOfFilesReadInFrontOfLoops >= 1
"use strict";
const table = []; const cache = []; const words = ["abc", "abcdefgh", "ab", "abcdefghijklmnopqrstuvwxyz", "", "a"];
function fill(text, n) { let i = 0; while (i < n) { cache[i] = text.charCodeAt(i); table[i] = ++i; } return table.length * 1000 + cache.length; }
function step(r) { const text = words[r % 6]; return fill(text, text.length + (r > 8 ? 2 : 0)) + JSON.stringify(cache.slice(0, 4)) + JSON.stringify(table.slice(-2)); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
