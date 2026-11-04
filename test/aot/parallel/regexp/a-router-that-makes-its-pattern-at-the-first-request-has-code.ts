// A router in the manner of hono's: a route is only noted when it is registered, and one pattern for all the routes of a method is made when the first request comes. No function on the way to RegExp knows the routes by itself:
// they lie in the router that the start of the program has filled. The build goes through the start of the program, and then calls each function that the start has handed to the host once, with what the start has left behind.
// COUNTER: RegExpsCreatedWithoutRecord = 0
// COUNTER: RegExpsCompiledToBytecode = 0
// COUNTER: RegExpMatchesInterpreted = 0
// COUNTER: RegExpPredictedTextsGivenCode >= 2
type Handler = (params: string[]) => string;
type Matcher = { pattern: RegExp; handlerAtMark: Handler[] };

class Router {
  #routes: [method: string, path: string, handler: Handler][] = [];
  #matchers: Record<string, Matcher> | null = null;

  add(method: string, path: string, handler: Handler) {
    if (this.#matchers) throw new Error("the matchers are built");
    this.#routes.push([method, path, handler]);
  }

  // `$()` behind each alternative: the one empty group that took part tells which alternative matched.
  #build() {
    const matchers: Record<string, Matcher> = {};
    for (const [method] of this.#routes) {
      if (matchers[method]) continue;
      const alternatives: string[] = [];
      const handlerAtMark: Handler[] = [];
      let groups = 0;
      for (const [of, path, handler] of this.#routes) {
        if (of !== method) continue;
        const text = path.replace(/:[a-z]+/g, () => {
          groups++;
          return "([^/]+)";
        });
        handlerAtMark[++groups] = handler;
        alternatives.push(text + "$()");
      }
      matchers[method] = { pattern: new RegExp("^(?:" + alternatives.join("|") + ")"), handlerAtMark };
    }
    return matchers;
  }

  match(method: string, path: string) {
    const matcher = (this.#matchers ??= this.#build())[method];
    const found = matcher?.pattern.exec(path);
    if (!matcher || !found) return "404";
    const mark = found.indexOf("", 1);
    return matcher.handlerAtMark[mark]!(found.slice(1, mark).filter(param => param !== undefined));
  }
}

const router = new Router();
router.add("GET", "/text", () => "text");
router.add("GET", "/users/:user/posts/:post", params => params.join("+"));
router.add("POST", "/shops/:shop/orders", params => "order for " + params[0]);
router.add("GET", "/files/:name", params => "file " + params[0]);

setTimeout(() => {
  const lines: string[] = [];
  for (const [method, path] of [
    ["GET", "/text"],
    ["GET", "/users/17/posts/4"],
    ["GET", "/users/17"],
    ["POST", "/shops/corner/orders"],
    ["POST", "/text"],
    ["GET", "/files/a.txt"],
    ["PUT", "/text"],
  ])
    lines.push(method + " " + path + " > " + router.match(method!, path!));
  console.log(lines.join("\n"));
}, 1);
