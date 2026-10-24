// Bun.serve calls `fetch` with the server as `this` and as the second argument. The program drops what Bun.serve answers, so the handler is the only one who has the server.
import { tmpdir } from "node:os";

class Body {
  mass = 3;
  respond(request: Request, server: any): Response {
    seen.push(this === undefined ? "none" : String(this.mass), typeof server, typeof server?.stop, String((this as any) === server));
    held = server;
    return new Response("ok");
  }
}

let held: any;
const seen: string[] = [];
const body = new Body();
const unix = tmpdir() + "/server-whose-result-is-dropped-" + process.pid + ".sock";
Bun.serve({ unix, fetch: body.respond });
const response = await fetch("http://localhost/", { unix });
console.log(await response.text(), seen.join(" "));
held.stop(true);
