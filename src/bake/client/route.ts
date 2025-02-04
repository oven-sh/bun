export function routeMatch(routeId: number, routePattern: string) {
  console.log(`routeMatch(${routeId}, ${routePattern})`);
  // TODO: pattern parsing
  // TODO: use routeId to cache the current route to avoid reparsing text we dont care about
  return routePattern === location.pathname;
}
