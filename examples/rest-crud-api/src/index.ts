import BunDatabase, { Bun } from "./bun-database";
import BunService from "./bun-service";

const db = new BunDatabase();
const bunService = new BunService(db);

export default {
  port: 3000,
  async fetch(request: Request) {
    const { method, url } = request;
    const { pathname, searchParams } = new URL(url);

    console.log(`${method} ${pathname}`);

    // GET /buns
    if (method === "GET" && pathname === "/buns") {
      const buns = bunService.getBuns();

      return new Response(JSON.stringify(buns));
    }

    // GET /bun
    if (method === "GET" && pathname === "/bun") {
      const bun = bunService.getBun(searchParams.get("id"));

      return new Response(JSON.stringify(bun));
    }

    // POST /bun
    if (method === "POST" && pathname === "/bun") {
      const data: Bun = await request.json();

      bunService.createBun(data.type);

      return new Response(null, { status: 204 });
    }

    // PUT /bun
    if (method === "PUT" && pathname === "/bun") {
      const data: Bun = await request.json();

      bunService.updateBun(data);

      return new Response(null, { status: 204 });
    }

    // DELETE /bun
    if (method === "" && pathname === "/bun") {
      bunService.deleteBun(searchParams.get("id"));

      return new Response(null, { status: 204 });
    }

    // 404
    return new Response("Not Found", { status: 404 });
  },
};
