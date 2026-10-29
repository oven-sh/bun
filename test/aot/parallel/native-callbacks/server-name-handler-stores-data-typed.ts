// As its neighbor without types: `this` is declared as any, and the handler also reads a property of the data and compares `this` with its first argument.
const finished = Promise.withResolvers<void>();
const said: string[] = [];
const data = { first: "kept", second: "kept" };
const handlers: any = {
  first: "of the handlers",
  data(): void {},
  serverName(this: any, given: unknown, name: string): void {
    said.push(this.first, String(this === given), String(this === data), name);
    this.calls = 1;
  },
};
const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, tls: true, data, socket: handlers });
Bun.connect({
  hostname: "127.0.0.1",
  port: listener.port,
  tls: { serverName: "localhost" },
  socket: {
    data(): void {},
    close(): void {
      finished.resolve();
    },
  },
}).catch((): void => {});
await finished.promise;
listener.stop(true);
console.log(said.join(), JSON.stringify(data), Object.keys(handlers).join());
