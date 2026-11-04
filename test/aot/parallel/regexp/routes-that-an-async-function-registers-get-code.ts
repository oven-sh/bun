// Many a server starts in an async function: it waits for a connection, reads its settings, and registers its routes behind that. The build goes through an async function in one go: what is awaited is the value
// that a settled promise holds, or what nobody knows; the call gives a promise that is settled. So the routes behind the `await` have their code in the image.
// COUNTER: RegExpsCreatedWithoutRecord = 0
// COUNTER: RegExpsCompiledToBytecode = 0
// COUNTER: RegExpMatchesInterpreted = 0
// COUNTER: RegExpPredictedTextsGivenCode >= 3
type Handler = (params: string[]) => string;

class Router {
  #layers: { pattern: RegExp; handler: Handler }[] = [];
  get(path: string, handler: Handler) {
    this.#layers.push({ pattern: new RegExp("^" + path.replace(/:[a-z]+/g, "([^/]+)") + "/?$", "i"), handler });
    return this;
  }
  handle(path: string) {
    for (const layer of this.#layers) {
      const found = layer.pattern.exec(path);
      if (found) return layer.handler(found.slice(1));
    }
    return "404";
  }
}

async function connect(name: string) {
  await new Promise(resolve => setTimeout(resolve, 1));
  return { name, prefix: "/api" };
}

const settings = async () => ({ version: "v" + (await Promise.resolve(2)) });

async function bootstrap() {
  const router = new Router();
  const database = await connect("main");
  const { version } = await settings();
  router.get(database.prefix + "/" + version + "/users/:user", params => "user " + params[0]);
  router.get(database.prefix + "/" + version + "/users/:user/posts/:post", params => params.join("+"));
  await null;
  router.get("/health", () => "ok from " + database.name);
  return router;
}

const router = await bootstrap();
console.log(["/api/v2/users/7", "/API/V2/users/7/posts/4/", "/health", "/api/v1/users/7", "/nothing"].map(path => path + " > " + router.handle(path)).join("\n"));
