// a typed literal
function door(i: number): Order {
  const items: Item[] = [];
  for (let k = 0; k < 4; k++) items.push({ sku: "s" + k, quantity: i + k });
  const shape: Circle | Square = i & 2 ? { kind: "circle", radius: i } : { kind: "square", side: i };
  const order: Order = { id: i, name: "n" + i, paid: (i & 1) === 0, price: i + 0.5, tax: i * 0.25, inner: { x: i, label: "l" }, items, shape };
  if (i & 1) order.note = "note";
  return order;
}
function doorForUser(i: number): User {
  const user = { id: i, name: "n" + i };
  label(user);
  return user;
}
