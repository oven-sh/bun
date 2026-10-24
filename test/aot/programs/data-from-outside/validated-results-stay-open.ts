// What JSON.parse<T>() and validate<T>() return has T's layout on the fast path and is an ordinary object with the same properties on the slow path. T keeps its typed layout, a position that a result reaches stays open, and typed code reads both kinds of object alike.
// IR+ ^layout L\d+ .*name="User" .* representation=Typed
// IR+ ^layout L\d+ .*name="Login" .* representation=Typed
// IR+ ^layout L\d+ .*name="Nested" .* representation=Typed
// IR+ ^layout L\d+ .*name="Within" .* representation=Typed
// IR- ^function f\d+ "(labelOf|triesOf|sumOf)" .*captures\([^)]*\)[^(]* \([^)]*(=L\d+|L\d+!)
import { validate } from "bun:bundle";
interface User { id: number; name: string }
interface Login { account: string; tries: number }
interface Within { x: number }
interface Nested { label: string; within: Within; list: Within[] }
function labelOf(user: User): string { return user.name + " #" + user.id; }
function triesOf(login: Login): number { return login.tries + login.account.length; }
function sumOf(nested: Nested): number { return nested.within.x + nested.list.length + nested.label.length; }
function main(text: string, value: unknown, deep: unknown): void {
  const user = JSON.parse<User>(text);
  const login = validate<Login>(value);
  const nested = validate<Nested>(deep);
  console.log(labelOf(user), triesOf(login), sumOf(nested));
}
main('{"id":7,"name":"Ada"}', JSON.parse('{"account":"ada","tries":2}'), JSON.parse('{"label":"l","within":{"x":1},"list":[{"x":2}]}'));
main('{"\\u0069d":8,"name":"Bo"}', { get account() { return "bo"; }, tries: 4 }, { label: "ll", within: Object.assign(Object.create(null), { x: 5 }), list: [{ x: 6 }, { x: 7 }] });
