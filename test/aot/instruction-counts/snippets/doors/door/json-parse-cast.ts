// JSON.parse(text) as T
function door(i: number): Order {
  return JSON.parse(textOf(i, "")) as Order;
}
function doorForUser(i: number): User {
  const user = JSON.parse(textOfUser(i, "")) as User;
  label(user);
  return user;
}
