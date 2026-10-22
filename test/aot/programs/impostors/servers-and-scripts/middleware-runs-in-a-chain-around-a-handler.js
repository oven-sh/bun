import http from "node:http";

function compose(middleware) {
  return (context, last) => {
    let reached = -1;
    const dispatch = index => {
      if (index <= reached) return Promise.reject(new Error("next() called twice"));
      reached = index;
      const step = index === middleware.length ? last : middleware[index];
      if (!step) return Promise.resolve();
      try {
        return Promise.resolve(step(context, () => dispatch(index + 1)));
      } catch (error) {
        return Promise.reject(error);
      }
    };
    return dispatch(0);
  };
}

const trace = [];
const cookies = header => Object.fromEntries((header ?? "").split(";").map(pair => pair.trim().split("=")).filter(pair => pair.length === 2).map(([name, value]) => [name, decodeURIComponent(value)]));
const run = compose([
  async (context, next) => {
    trace.push("timer in");
    await next();
    context.response.setHeader("x-steps", String(trace.length));
    trace.push("timer out");
  },
  async (context, next) => {
    try {
      await next();
    } catch (error) {
      context.status = error.status ?? 500;
      context.body = { error: error.message };
    }
  },
  (context, next) => {
    context.user = cookies(context.request.headers.cookie).user;
    if (!context.user) throw Object.assign(new Error("sign in first"), { status: 401 });
    return next();
  },
  context => {
    if (context.request.url === "/boom") null.property;
    context.body = { hello: context.user, path: context.request.url };
  },
]);

const server = http.createServer(async (request, response) => {
  const context = { request, response, status: 200, body: null };
  await run(context);
  response.statusCode = context.status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(context.body));
});
server.listen(0, "127.0.0.1", async () => {
  const base = "http://127.0.0.1:" + server.address().port;
  for (const [path, cookie] of [["/a", "user=ada%20l; theme=dark"], ["/b", ""], ["/boom", "user=bob"], ["/c", "broken; user=cy"]]) {
    const answer = await fetch(base + path, { headers: cookie ? { cookie } : {} });
    const body = await answer.json();
    console.log(path, answer.status, answer.headers.get("x-steps"), body.error ? typeof body.error : body);
  }
  console.log(trace.length);
  server.close();
});
