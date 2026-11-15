// `data.rows[i]` in a loop; `rows` is a getter written in the literal: the accessor's pair lies in the slot. No slot in which an accessor lies is read raw in front of the loop: every read runs the getter, and its calls are counted. Under --aot-harden=proof-checks the build that read it raw stopped: the pair is no value of the language.
function f(data, t) { let s = t & 1; for (let i = 0; i < data.rows.length; i++) s = s + data.rows[i]; return s; }
let calls = 0; const rows = [3, 1, 4, 1, 5]; const data = { get rows() { calls++; return rows; } };
const rounds = JSON.parse("3");
for (let r = 0; r < rounds; r++) console.log(f(data, r), calls);
