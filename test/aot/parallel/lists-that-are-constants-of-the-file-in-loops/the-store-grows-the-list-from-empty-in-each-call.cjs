// STATISTIC: ModuleConstantReadsHoisted >= 1
"use strict";
const sums = []; const heights = []; const words = ["abc", "abcdefgh", "ab", "abcdefghijklmnopqrstuvwxyz", "", "a"];
function stake(text, n) { for (let post = 0; post < n; post++) { sums[post] = post * 3 - 1; heights[post] = text.charCodeAt(post) - 90; } return sums.length * 1000 + heights.length; }
function step(r) { const text = words[r % 6]; return stake(text, text.length + (r > 8 ? 2 : 0)) + JSON.stringify(heights.slice(0, 4)) + JSON.stringify(sums.slice(-2)); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
