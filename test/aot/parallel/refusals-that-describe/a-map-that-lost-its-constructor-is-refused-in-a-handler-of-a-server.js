// The same inside a handler, on bytes that come out of the request.
const held = new Map([["place", new URL("http://made.up/a")]]);
held.constructor = undefined;
let text = "no refusal";
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    try {
      Buffer.from(await request.arrayBuffer()).compare(held);
    } catch (error) {
      text = `${error}`;
    }
    return new Response("made up");
  },
});
await server.fetch(new Request("http://made.up/", { method: "POST", body: "made up" }));
server.stop(true);
console.log(`${text.includes("href")} ${text.includes("made.up")} ${text.slice(0, 34)}`);
