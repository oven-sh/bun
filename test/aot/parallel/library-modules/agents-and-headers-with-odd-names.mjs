// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import http from "node:http";
import https from "node:https";
{
  const agent = new http.Agent();
  agent.getName = () => "toLocaleString";
  agent.freeSockets = new Date(0);
  try {
    agent.addRequest({ onSocket() {}, once() {}, on() {}, emit() {} }, { host: "localhost", port: 1 });
    console.log("no throw");
  } catch (error) {
    console.log(error.name);
  }
}
{
  const agent = new https.Agent({ maxCachedSessions: 2 });
  agent._cacheSession("a:1", "one");
  agent._cacheSession("constructor", "two");
  agent._cacheSession("b:2", "three");
  console.log(
    agent._getSession("a:1"),
    agent._getSession("constructor"),
    agent._getSession("b:2"),
    agent._getSession("valueOf"),
  );
  agent._evictSession("b:2");
  console.log(agent._getSession("b:2"), agent._sessionCache.list);
}
{
  const response = new http.ServerResponse({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1 });
  response.setHeader("constructor", "a");
  response.setHeader("__proto__", "b");
  console.log(
    response.getHeader("constructor"),
    response.getHeader("__proto__"),
    response.getHeader("toString"),
    response.hasHeader("valueOf"),
    Object.keys(response.getHeaders()).join(),
  );
}
