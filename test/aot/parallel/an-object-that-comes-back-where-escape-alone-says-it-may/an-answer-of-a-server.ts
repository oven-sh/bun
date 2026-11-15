const box: any = { v: "first" };
const list = JSON.parse("[]");
list[0] = box;
const server = Bun.serve({ port: 0, fetch(request) { const made = new Response("x"); list[0].v = made; return made; } });
await fetch("http://localhost:" + server.port + "/");
console.log(box.v.status, box.v); server.stop();
