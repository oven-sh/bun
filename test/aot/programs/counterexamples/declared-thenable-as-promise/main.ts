// A package's declaration file derives the type of its thenable from Promise<T>, as Prisma's does. The thenable is no promise object, and it enters every location of the type Promise<T>.
import { query } from "./package.js";

interface User {
  name: string;
  age: number;
}
class Pending {
  held: Promise<number>;
  constructor(held: Promise<number>) {
    this.held = held;
  }
}
function findUser(): Promise<User> {
  return query("user", { name: "ada", age: 36 });
}
function count(): Promise<number> {
  return query("count", 3);
}
async function double(pending: Promise<number>): Promise<number> {
  return (await pending) * 2;
}
async function forward(): Promise<number> {
  return count();
}

const variable: Promise<string> = query("text", "four");
const list: Promise<number>[] = [count(), Promise.resolve(4), new Promise<number>(resolve => resolve(5))];

const user = await findUser();
console.log("a result:", user.name, user.age);
console.log("a parameter:", await double(count()));
console.log("a field:", await new Pending(count()).held);
console.log("a variable:", (await variable).length);
for (const pending of list) console.log("an element:", await pending, pending instanceof Promise);
console.log("the result of an async function:", await forward());
console.log("an assertion:", await (query("cast", 6) as Promise<number>));
console.log("then:", await count().then(value => value + 1));
console.log("all:", (await Promise.all([count(), double(count())])).join());
