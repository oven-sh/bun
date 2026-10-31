// As its neighbor without types: `this` is declared as any, and the handler says what the store did.
const finished = Promise.withResolvers<void>();
const said: string[] = [];
const handlers: any = {
  data(): void {},
  serverName(this: any): void {
    try {
      this.calls = 1;
      said.push("stored");
    } catch (error) {
      said.push((error as Error).name);
    }
  },
};
const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, tls: true, socket: handlers });
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
console.log(said.join(), Object.keys(handlers).join());
