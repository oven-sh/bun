export {}; const g = [globalThis][JSON.parse("0")], other = JSON.parse('"other1"');
function put(o, v) { for (let i = 0; i < 8; i++) o.x1 = v + i; }
const show = () => console.log(JSON.stringify(Object.getOwnPropertyDescriptor(g, "x1")), g[other]);
for (let i = 0; i < 600; i++) g["pad" + i] = i; put(g, 10); show();
for (let i = 0; i < 400; i++) delete g["pad" + i];
put(g, 20); delete g.x1; g[other] = "o"; put(g, 30); show();
for (let i = 400; i < 500; i++) delete g["pad" + i];
put(g, 40); Object.defineProperty(g, "x1", { writable: false }); try { put(g, 50); console.log("quiet"); } catch (e) { console.log(e.name); } show();
