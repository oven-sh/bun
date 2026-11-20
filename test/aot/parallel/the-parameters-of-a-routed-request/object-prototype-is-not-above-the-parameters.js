// An empty object is above them, and above that an object without a prototype that bears the tag.
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  routes: {
    "/made/:name": request => {
      const { params } = request;
      console.log(`${params.toString} ${params.hasOwnProperty} ${params.constructor} ${"valueOf" in params}`);
      console.log(
        `${params instanceof Object} ${Object.prototype.toString.call(params)} ${Object.hasOwn(params, "name")}`,
      );
      for (const use of [() => `${params}`, () => params.hasOwnProperty("name"), () => params + 1]) {
        try {
          console.log(use());
        } catch (error) {
          console.log(error.name);
        }
      }
      const above = Object.getPrototypeOf(params);
      const tag = Object.getPrototypeOf(above);
      console.log(`${Reflect.ownKeys(above).length} ${Reflect.ownKeys(tag).length} ${tag[Symbol.toStringTag]}`);
      console.log(`${Object.getPrototypeOf(tag)} ${above === Object.prototype}`);
      return new Response("done");
    },
  },
});
console.log(await (await fetch(new URL("/made/up", server.url))).text());
await server.stop(true);
