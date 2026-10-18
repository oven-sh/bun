// What JSON.parse<T>() and Bun.validate<T>() return is a T for the compiler, however it is handed on: the layouts take nothing that typed code did not make.
// IR- ^shape .*"User".* accepts-untyped
// IR- ^shape .*"Login".* accepts-untyped
// IR- ^shape .*"Nested".* accepts-untyped
// IR- ^shape .*"Within".* accepts-untyped
interface User { id: number; name: string }
interface Login { account: string; tries: number }
interface Within { x: number }
interface Nested { label: string; within: Within; list: Within[] }
function labelOf(user: User): string { return user.name + " #" + user.id; }
function triesOf(login: Login): number { return login.tries + login.account.length; }
function sumOf(nested: Nested): number { return nested.within.x + nested.list.length + nested.label.length; }
function main(text: string, value: unknown, deep: unknown): void {
  const user = JSON.parse<User>(text);
  const login = Bun.validate<Login>(value);
  const nested = Bun.validate<Nested>(deep);
  console.log(labelOf(user), triesOf(login), sumOf(nested));
}
main('{"id":7,"name":"Ada"}', JSON.parse('{"account":"ada","tries":2}'), JSON.parse('{"label":"l","within":{"x":1},"list":[{"x":2}]}'));
