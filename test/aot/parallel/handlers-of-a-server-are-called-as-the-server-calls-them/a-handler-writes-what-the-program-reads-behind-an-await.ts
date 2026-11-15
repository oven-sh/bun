let count = 0;
const state = { hits: 0, last: "none" };
function look() { let work = 0; for (let k = 0; k < 2; k++) work += k; return state.hits + ":" + state.last + ":" + count; }
const server = Bun.serve({ port: 0, fetch(request) { count++; state.hits += 2; state.last = new URL(request.url).pathname; return new Response("x"); } });
const told = [look()];
for (let turn = 0; turn < 3; turn++) { await fetch(new URL("/" + turn, server.url)); told.push(look()); }
await server.stop(true);
console.log(told.join());
