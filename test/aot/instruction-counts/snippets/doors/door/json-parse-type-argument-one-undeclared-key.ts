// JSON.parse<T>(text), one undeclared key
function door(i: number): Order {
  return JSON.parse<Order>(textOf(i, ',"extra":1'));
}
