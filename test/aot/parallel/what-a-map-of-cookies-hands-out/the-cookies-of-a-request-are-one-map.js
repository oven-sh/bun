// The map is made of the header at the first read and kept in the request. What is set in it goes out with the response.
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  routes: {
    "/made-up": request => {
      const cookies = request.cookies;
      cookies.mark = 1;
      console.log(
        `${cookies === request.cookies} ${request.cookies.mark} ${cookies instanceof Bun.CookieMap} ${cookies.get("a")} ${cookies.size}`,
      );
      console.log(`${Reflect.get(Object.getPrototypeOf(request), "cookies", {})}`);
      cookies.set("b", "2");
      return new Response("done");
    },
  },
});
const response = await fetch(new URL("/made-up", server.url), { headers: { cookie: "a=1" } });
console.log(`${await response.text()} ${response.headers.getSetCookie().join(" | ")}`);
await server.stop(true);
