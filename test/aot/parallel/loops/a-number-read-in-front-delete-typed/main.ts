function f(m: number[], o: any, xs: number[]) { let s = 0; for (let i = 0; i < xs.length; i++) { s += m[0] * xs[i]; if (i === 1) delete o[0]; } return s; }
(async () => { try { console.log("SAID", String(await (async () => { const m = JSON.parse("[0.5,1.5,2.5,3.5]"); return f(m, m, JSON.parse("[1,2,3,4]")); })())); } catch (error) { console.log("SAID", (error as Error).name); } })();
export {};
