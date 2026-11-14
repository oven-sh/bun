// every deleted /(\w)-(\w)?(\w)?/
const subjects = ["alpha-12", "bat", "ba", "", "2026-11-10", "a-bc", "xx", "\u0101b-1-ba", "ba\u0101", "abcdefghijklmnopqrstuvwxyz", "x".repeat(70) + "-7"]; const all = [...subjects, ...subjects.map((s, i) => s + String(i)), ...subjects.map(s => ("xy" + s + "zw").slice(2, 2 + s.length))]; const kept = [], out = [];
const r = /(\w)-(\w)?(\w)?/;
function f(re, s) { let t = ""; const a = re.exec(s); if (a) { for (let i = 0; i < a.length; i++) t += a[i] + ","; t += a.index; } return t; }
function store(re) { re.exec = function (s) { return [s]; }; delete re.exec; } 
function run(list) { const o = []; for (let i = 0; i < list.length; i++) { r.lastIndex = 0; o.push(f(r, list[i])); } return o.map(String).join(";"); }
console.log(run(all), r.lastIndex); store(r); console.log(run(all)); console.log(kept.map(k => Array.prototype.join.call(k, "|") + "@" + k.index).join(";")); console.log(out.map(String).join(";"));
