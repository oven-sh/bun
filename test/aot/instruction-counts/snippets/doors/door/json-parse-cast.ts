// JSON.parse(text) as T
function door(i: number): Order {
  return JSON.parse(textOf(i, "")) as Order;
}
