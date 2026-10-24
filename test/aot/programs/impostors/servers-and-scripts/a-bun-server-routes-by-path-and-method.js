const notes = new Map();
let nextId = 1;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const match = /^\/notes\/(\d+)$/.exec(url.pathname);
    if (url.pathname === "/notes" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body || typeof body.text !== "string") return Response.json({ error: "text is missing" }, { status: 422 });
      const note = { id: nextId++, text: body.text, tags: body.tags ?? [] };
      notes.set(note.id, note);
      return Response.json(note, { status: 201, headers: { location: "/notes/" + note.id } });
    }
    if (url.pathname === "/notes" && request.method === "GET") {
      const tag = url.searchParams.get("tag");
      return Response.json([...notes.values()].filter(note => !tag || note.tags.includes(tag)));
    }
    if (match && request.method === "GET") {
      const note = notes.get(Number(match[1]));
      return note ? Response.json(note) : new Response("no such note", { status: 404 });
    }
    if (match && request.method === "DELETE") return new Response(null, { status: notes.delete(Number(match[1])) ? 204 : 404 });
    return new Response("method or path not known", { status: 405, headers: { allow: "GET, POST, DELETE" } });
  },
  error(error) {
    return new Response("failed: " + error.message, { status: 500 });
  },
});

const send = (path, method = "GET", body) => fetch(server.url + path.slice(1), { method, body: body === undefined ? undefined : JSON.stringify(body) });
const created = await send("/notes", "POST", { text: "first", tags: ["a", "b"] });
console.log(created.status, created.headers.get("location"), await created.json());
console.log((await send("/notes", "POST", { text: "second" })).status);
console.log((await send("/notes", "POST", { text: 5 })).status, (await send("/notes", "POST")).status);
console.log(await (await send("/notes?tag=b")).json());
console.log(await (await send("/notes/2")).json(), (await send("/notes/9")).status);
console.log((await send("/notes/1", "DELETE")).status, (await send("/notes/1", "DELETE")).status);
const refused = await send("/notes", "PATCH");
console.log(refused.status, refused.headers.get("allow"), await refused.text());
await server.stop(true);
console.log("stopped", notes.size);
