const out: string[] = [];
async function one(i: number) { try { return await new Promise<number>((resolve, reject) => { if (i & 1) reject(new Error("odd " + i)); else resolve(i); }); } catch (e: any) { return e.message; } finally { out.push("finally " + i); } }
function* two(n: number) { for (let i = 0; i < n; i++) yield new Promise<number>(resolve => resolve(i * 2)); }
async function* three(n: number) { for (let i = 0; i < n; i++) yield await new Promise<string>(resolve => setTimeout(resolve, 0, "timer " + i)); }
function four(i: number) { try { return new Promise<number>(() => { throw new Error("inside " + i); }); } catch (e) { out.push("CAUGHT OUTSIDE"); throw e; } finally { out.push("left " + i); } }
for (let i = 0; i < 4; i++) out.push(String(await one(i)));
for (const p of two(3)) out.push(String(await p));
for await (const v of three(3)) out.push(v);
for (let i = 0; i < 2; i++) await four(i).catch(e => out.push(e.message));
console.log(out.join(" | "));
