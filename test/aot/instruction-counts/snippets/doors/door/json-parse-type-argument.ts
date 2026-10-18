// JSON.parse<T>(text)
function door(i: number): Order {
  return JSON.parse<Order>(textOf(i, ""));
}
