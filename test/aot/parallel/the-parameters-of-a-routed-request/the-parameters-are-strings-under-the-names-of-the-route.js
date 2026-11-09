// A string under each name of the route, decoded. The same object at every read.
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  routes: {
    "/made/:first/up/:second": request => {
      const { params } = request;
      console.log(`${params.first} ${params.second} ${typeof params.first} ${params === request.params}`);
      console.log(`${Object.keys(params)} ${JSON.stringify(params)} ${params.third}`);
      for (const name in params) console.log(`${name}=${params[name]}`);
      console.log(`${Reflect.deleteProperty(params, "first")} ${params.first}`);
      return new Response(params.second.toUpperCase());
    },
  },
});
const response = await fetch(new URL("/made/a%20b/up/c", server.url));
console.log(await response.text());
console.log(`${Reflect.get(Object.getPrototypeOf(new Request("http://made.up")), "params")}`);
await server.stop(true);
