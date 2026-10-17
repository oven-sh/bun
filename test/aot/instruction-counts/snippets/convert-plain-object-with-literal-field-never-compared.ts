// passes plain objects to a typed function whose record type has a field that is a union of string literals; the program never compares that field with a text
type Author = { login: string };
type Hit = { state: "open" | "closed"; author: Author; title: string };
const operations = 100;
const makeAuthor = (login: string): Author => ({ login });
const makeHit = (author: Author): Hit => ({ state: "open", author, title: "typed" });
const read = (hit: Hit) => hit.state.length + hit.author.login.length;
const author = makeAuthor("u");
let total = read(makeHit(author));

kernel: {
  for (let i = 0; i < operations; i++) {
    const hit: any = { state: i & 1 ? "open" : "closed" };
    hit.author = author;
    hit.title = "grown";
    total += read(hit);
  }
}

console.log(total);
