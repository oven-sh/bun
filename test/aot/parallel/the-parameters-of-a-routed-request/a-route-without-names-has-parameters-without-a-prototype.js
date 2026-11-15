// Nothing is above them and nothing is in them.
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  routes: {
    "/made/up": request => {
      const { params } = request;
      console.log(`${typeof params} ${Object.getPrototypeOf(params)} ${Reflect.ownKeys(params).length}`);
      console.log(`${params.name} ${params.toString} ${Object.prototype.toString.call(params)}`);
      console.log(`${params === request.params}`);
      return new Response("done");
    },
  },
});
console.log(await (await fetch(new URL("/made/up", server.url))).text());
await server.stop(true);
