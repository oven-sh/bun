function f(xs: number[]) { let s = 0; for (let i = 0; i < xs.length; i++) s += late[0] * xs[i]; return s; }
let early: any; try { early = f(JSON.parse("[1,2,3,4]")); } catch (error) { early = (error as Error).name; }
const late: number[] = JSON.parse("[0.5,1.5,2.5,3.5]");
(async () => { try { console.log("SAID", String(await (async () => { return early; })())); } catch (error) { console.log("SAID", (error as Error).name); } })();
export {};
