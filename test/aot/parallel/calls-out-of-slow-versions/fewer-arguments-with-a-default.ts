interface Box { v: number; w: number }
const log: string[] = [];
function note(text: string): number { log.push(text); return log.length; }
function callee(a: number, b = 7, c: number = a + b) { return a * 100 + b * 10 + c; }
function outer(box: Box): unknown {
    let work = 0; for (let i = 0; i < 2; i++) work = (work + box.v + box.w) | 0;
    return callee(box.v) + work;
}

function show(run: () => unknown) { try { console.log(String(run())); } catch (e) { console.log("thrown", (e as Error).name, (e as Error).message.length > 0); } }
const fits: Box = { v: 3, w: 4 };
for (let i = 0; i < 3; i++) show(() => outer(fits));
show(() => outer(JSON.parse('{"z":1,"v":5,"w":6}')));
show(() => outer({ w: 8, v: 7, more: true } as any));
show(() => (outer as any)("text"));
show(() => (outer as any)({ v: "s", w: 1.5 }));
show(() => (outer as any)({ get v() { return note("getter"); }, w: 2 }));
show(() => (outer as any)(undefined));
console.log(log.join());
