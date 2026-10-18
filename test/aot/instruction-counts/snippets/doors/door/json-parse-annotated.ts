// const order: T = JSON.parse(text)
function door(i: number): Order {
  const order: Order = JSON.parse(textOf(i, ""));
  return order;
}
function doorForUser(i: number): User {
  const user: User = JSON.parse(textOfUser(i, ""));
  label(user);
  return user;
}
