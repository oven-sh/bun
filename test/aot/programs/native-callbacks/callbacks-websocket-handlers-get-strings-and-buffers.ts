// Callbacks handed over: the server calls open, message and close of the websocket handlers, with a string or a Buffer as the message and with the data that upgrade was given, of any type; the client's listeners get events.
export {};

let total = 0;
const done = Promise.withResolvers<void>();

function onMessage(message: string): void {
  total += typeof message === "string" ? message.length : Buffer.isBuffer(message) ? 100 : 10000;
}

onMessage("a");
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request, self) {
    return self.upgrade(request, { data: new URL(request.url).pathname === "/text" ? "text" : { id: 5 } } as any) ? undefined : new Response("no");
  },
  websocket: {
    open(socket) {
      const data = socket.data as unknown as { id: number };
      total += typeof data === "string" ? 1000000 : typeof data.id === "number" ? 10000000 : 0;
    },
    message(socket, message) {
      onMessage(message as string);
      socket.send(message);
    },
    close(socket, code, reason) {
      total += typeof code === "number" && typeof reason === "string" ? 100000000 : 0;
      done.resolve();
    },
  },
});
const client = new WebSocket(`ws://127.0.0.1:${server.port}/text`);
client.binaryType = "arraybuffer";
let echoes = 0;
client.onopen = () => (client.send("hello"), client.send(new Uint8Array([1, 2])));
client.onmessage = event => {
  total += typeof event.data === "string" ? 1000 : event.data instanceof ArrayBuffer ? 2000 : 0;
  if (++echoes === 2) client.close(1000, "bye");
};
await done.promise;
await server.stop(true);
console.log(total);
