const list: string[] = JSON.parse('["i\\u0307stanbul","strasse\\u00df","STRASSESS","\\u03c3\\u03b1\\u03c2","ab-ab-ab"]');
function low(q: string): number { let n = 0; for (let i = 0; i < list.length; i++) if (list[i] === q.toLowerCase()) n += i + 1; return n; }
function up(q: string): number { let n = 0; for (let i = 0; i < list.length; i++) if (list[i] === q.toUpperCase()) n += i + 1; return n; }
(globalThis as any).kept = [low, up];
const part: string = JSON.parse('"AB"');
const all: string[] = JSON.parse('["\\u0130stanbul","STRASSE\\u00df","strasse\\u00df","\\u03a3\\u0391\\u03a3"]');
all.push(part + "-" + part + "-" + part);
console.log(all.map((q) => low(q) + ":" + up(q)).join());
