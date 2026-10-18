// JSON.parse<T>(text)
function door(i: number): Order {
  return JSON.parse<Order>(textOf(i, ""));
}
function doorForUser(i: number): User {
  const user = JSON.parse<User>(textOfUser(i, ""));
  label(user);
  return user;
}
