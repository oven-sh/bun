const handlers = [];
export function on(handler) {
  handlers.push(handler);
}
export function fire(value) {
  console.log("fires for", handlers.length);
  for (const handler of handlers) handler(value);
}
