// const order: T = JSON.parse(text)
function door(i: number): Order {
  const order: Order = JSON.parse(textOf(i, ""));
  return order;
}
