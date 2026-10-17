// passes object literals typed any, which nothing else holds, to a typed function whose record type has a field that is a union of string literals
type Author = { login: string };
type Hit = { id: number; state: "open" | "closed"; author: Author };
const operations = 100;
const makeAuthor = (login: string): Author => ({ login });
const makeHit = (id: number, author: Author): Hit => ({ id, state: "open", author });
const read = (hit: Hit) => hit.id + (hit.state === "closed" ? 1 : 2) + hit.author.login.length;
const author = makeAuthor("u");
let total = read(makeHit(1, author));

kernel: {
  for (let i = 0; i < operations; i++) {
    const hit: any = { id: i, state: i & 1 ? "open" : "closed", author };
    total += read(hit);
  }
}

console.log(total);
