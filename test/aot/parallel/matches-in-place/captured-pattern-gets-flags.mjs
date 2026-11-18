const all = ["aab", "bb1", "", "a-b", "\u0101b", "x".repeat(70) + "b"];
function Exec(re, string) { let sum = 0; re.lastIndex = 0; const array = re.exec(string); if (array) { for (let i = 0; i < array.length; i++) { const part = array[i]; if (part) sum += part.length * (i + 1); } } return sum; }
function Test(re, s) { return re.test(s) ? 1 : 0; }
function H() { this.run = run; var re = /b/; this.drop = () => { re = /b/g; }; function run(list) { const out = []; for (let i = 0; i < list.length; i++) { const s = list[i]; out.push(Exec(re, s), Test(re, s), s.replace(re, "").length); } return out.join(); } } const h = new H(); console.log(h.run(all)); h.drop(); console.log(h.run(all));
