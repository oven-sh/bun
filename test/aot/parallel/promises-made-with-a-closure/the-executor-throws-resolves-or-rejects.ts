const out: string[] = [];
function make(i: number) { return new Promise<number>((resolve, reject) => { if (i % 3 === 0) throw new RangeError("thrown " + i); if (i % 3 === 1) resolve(i); else reject(new TypeError("rejected " + i)); }); }
for (let i = 0; i < 9; i++) make(i).then(v => out.push("value " + v), e => out.push(e.name + " " + e.message));
await null; await null; await null; console.log(out.join(" | "));
