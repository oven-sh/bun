// JSON.parse<T>(text), one undeclared key
function door(i: number): Order {
  return JSON.parse<Order>(textOf(i, ',"extra":1'));
}
function doorForUser(i: number): User {
  const user = JSON.parse<User>(textOfUser(i, ',"extra":1'));
  label(user);
  return user;
}
