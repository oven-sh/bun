// The object is the program's to write on, and so is the object above it. A clone gets the values under the names that can be listed.
class Made {
  say() {
    return "said";
  }
}
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  routes: {
    "/made/:name": request => {
      request.params.more = new Made();
      request.params[0] = "zero";
      Object.defineProperty(request.params, "read", {
        get: () => (console.log("read"), new Made()),
        enumerable: true,
      });
      Object.getPrototypeOf(request.params).above = () => "above";
      console.log(`${request.params.more.say()} ${request.params.above()} ${Object.keys(request.params)}`);
      const clone = request.clone();
      console.log(
        `${clone.params === request.params} ${clone.params.more === request.params.more} ${clone.params.name}`,
      );
      console.log(`${clone.params.read.say()} ${clone.params[0]} ${clone.params.above()} ${Object.keys(clone.params)}`);
      return new Response("done");
    },
  },
});
console.log(await (await fetch(new URL("/made/up", server.url))).text());
await server.stop(true);
