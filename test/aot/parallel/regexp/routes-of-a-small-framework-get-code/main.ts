// A framework in the manner of express: `app.get("/users/:id", ..)` in the body of the entry module, the pattern made five calls down, in a CommonJS module, by a constructor function, out of a text that a helper
// has taken apart with patterns of its own. The build goes through the start of the program as the program does, so every route has code in the image and no request is matched by the run time's own matcher.
// COUNTER: RegExpsCreatedWithoutRecord = 0
// COUNTER: RegExpsCompiledToBytecode = 0
// COUNTER: RegExpMatchesInterpreted = 0
// COUNTER: RegExpPredictedTextsGivenCode >= 5
import framework from "./framework.cjs";

const app = framework();
app.get("/text", () => "text");
app.get("/users/:userId/posts/:postId", (params: Record<string, string>) => params.userId + "+" + params.postId);
app.post("/shops/:shop/orders", async () => "never awaited", (params: Record<string, string>) => "order for " + params.shop);
app.get("/files/*rest", (params: Record<string, string>) => "file " + params.rest);
app.all("/a.b(c)", () => "escaped");

const lines: string[] = [];
for (const [method, path] of [
  ["GET", "/text"],
  ["GET", "/TEXT/"],
  ["POST", "/text"],
  ["GET", "/users/17/posts/4"],
  ["GET", "/users/17/posts"],
  ["POST", "/shops/corner/orders"],
  ["GET", "/files/a/b/c.txt"],
  ["PUT", "/a.b(c)"],
  ["PUT", "/aXb(c)"],
  ["GET", "/nothing"],
])
  lines.push(method + " " + path + " > " + app.handle(method!, path!));
console.log(lines.join("\n"));
