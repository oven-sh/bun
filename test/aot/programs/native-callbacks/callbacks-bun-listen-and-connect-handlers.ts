// Callbacks handed over: Bun.listen and Bun.connect call open, data and close on handlers that are class instances, with a native socket and a Buffer, and `socket.data` is whatever was given; the program's own calls pass numbers.
export {};

let total = 0;
const closed = Promise.withResolvers<void>();

class Handlers {
  constructor(public weight: number) {}
  open(socket: number): void {
    total += typeof socket === "number" ? 1 : 100 * this.weight;
    if (typeof socket !== "number" && this.weight === 2) (socket as any).write("ping");
  }
  data(socket: number, chunk: number): void {
    total += typeof chunk === "number" ? 10000 : Buffer.isBuffer(chunk) ? 100000 * this.weight : 0;
    total += typeof (socket as any).data === "string" ? 10000000 : 0;
    (socket as any).end();
  }
  close(): void {
    if (this.weight === 1) closed.resolve();
  }
}

new Handlers(0).open(1);
const own = new Handlers(0);
own.data({ end() {} } as any, 1);
const bind = (handlers: Handlers): any => ({ open: (socket: any) => handlers.open(socket), data: (socket: any, chunk: any) => handlers.data(socket, chunk), close: () => handlers.close() });
const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: bind(new Handlers(1)), data: "server side" } as any);
await Bun.connect({ hostname: "127.0.0.1", port: listener.port, socket: bind(new Handlers(2)), data: 5 } as any);
await closed.promise;
listener.stop(true);
console.log(total);
