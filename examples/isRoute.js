export function isRoute(expr, env) {
  return env.url.pathname.includes(expr.arguments[0].toString());
}
