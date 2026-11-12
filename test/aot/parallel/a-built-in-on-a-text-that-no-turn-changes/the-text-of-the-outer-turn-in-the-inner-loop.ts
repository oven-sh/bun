const words: string[] = JSON.parse('["One","TWO","three", null, "Two"]'), list: string[] = JSON.parse('["one","two","three","two"]');
function run(): string { let s = ""; for (let j = 0; j < words.length; j++) { let c = 0; try { const w: string = words[j]; for (let i = 0; i < list.length; i++) if (list[i] === w.toLowerCase()) c++; } catch (e: any) { c = -1; } s += c + ","; } return s; }
(globalThis as any).kept = run;
console.log(run(), run());
