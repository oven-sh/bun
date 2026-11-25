// Objects laid over each other by spread, later ones win, order kept
function layer(port, name) {
  const base = { port: 80, host: "local", name: null };
  const user = { port, name };
  const merged = { ...base, ...user, extra: true, ...(port > 100 ? { high: port } : null) };
  const { host, ...rest } = merged;
  return host + " " + JSON.stringify(rest) + " " + base.port;
}
console.log(layer(8080, "a"));
console.log(layer(1, "b"));
console.log(layer(443, ""));
