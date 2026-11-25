// What a listener answers under `data` is what the program handed in: native code makes no object there. Nothing here makes a promise or prints an object.
// STATISTIC: ImageFunctionsEmitted <= 30
const held = { count: 2, twice() { return this.count * 2; } };
const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} }, data: held });
console.log(listener.data === held, listener.data.twice(), typeof listener.port);
listener.data = { count: 5, twice: held.twice };
console.log(listener.data === held, listener.data.twice());
listener.stop(true);
