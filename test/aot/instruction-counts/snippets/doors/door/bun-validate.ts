// Bun.validate<T>(value)
function door(i: number): Order {
  return Bun.validate<Order>(JSON.parse(textOf(i, "")));
}
function doorForUser(i: number): User {
  const user = Bun.validate<User>(JSON.parse(textOfUser(i, "")));
  label(user);
  return user;
}
