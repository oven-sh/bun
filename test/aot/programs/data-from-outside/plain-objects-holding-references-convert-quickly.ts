declare const aotOperationCount: (name: string) => number;
// A plain object that untyped code built enters a typed parameter: any object passes and stays the same object, also when its properties hold typed objects, arrays and functions. A property of the wrong kind throws where typed code reads it, and one that is missing reads undefined. For 400 objects of one shape the slow type test of the runtime is entered fewer than 20 times.
type Author = { nick: string; editor: Author | null };
type Post = { id: number; author: Author; tags: string[]; render: (text: string) => string; note: unknown; reviewer?: Author };

function ownAuthor(nick: string): Author {
  return { nick, editor: null };
}
function ownPost(id: number): Post {
  return { id, author: ownAuthor("own"), tags: ["own"], render: text => text, note: null };
}
function show(post: Post): string {
  return post.id + " " + post.author.nick + " " + post.tags.join("+") + " " + post.render("r") + " " + String(post.note) + " " + (post.reviewer ? post.reviewer.nick : "-");
}
function renumber(post: Post, id: number): void {
  post.id = id;
}
function grow(id: unknown, author: unknown, tags: unknown, render: unknown, note: unknown): any {
  const post: any = { id };
  post.author = author;
  post.tags = tags;
  post.render = render;
  post.note = note;
  return post;
}
function firstLine(f: () => string): string {
  try {
    return f();
  } catch (e) {
    return e instanceof Error ? e.name + ": " + e.message.split("\n")[0].replace(/ \(bun compile[^)]*\)/, "") : String(e);
  }
}

console.log(show(ownPost(0)));

const author = ownAuthor("a");
const tags = ["x", "y"];
const upper = (text: string) => text.toUpperCase();
const kept: any[] = [];
let text = "";
const before = aotOperationCount("operationAOTEnforceType");
for (let i = 0; i < 400; i++) {
  const post = grow(i, author, tags, upper, i % 2 ? "n" : [i]);
  kept.push(post);
  text = show(post);
}
const slow = aotOperationCount("operationAOTEnforceType") - before;
console.log(text, slow < 20 ? "cached" : "not cached: " + slow);

const same = kept[7];
renumber(same, 70);
console.log(same.id, kept[7] === same, Object.keys(same).join(), JSON.stringify(same));
same.added = 1;
console.log(JSON.stringify(same), show(same));
for (let i = 0; i < kept.length; i++) {
  if (kept[i].author !== author || kept[i].tags !== tags || kept[i].render !== upper || (i !== 7 && kept[i].id !== i)) console.log("changed", i);
}

console.log(firstLine(() => show(grow(2, author, tags, upper, author))));
console.log(firstLine(() => show(grow(3, author, tags, upper, undefined))));
console.log(firstLine(() => show(grow(4, author, "no array", upper, 0))));
console.log(firstLine(() => show(grow(5, author, tags, "no function", 0))));
console.log(firstLine(() => show(grow(6, "no author", tags, upper, 0))));
console.log(firstLine(() => show(grow(7, tags, tags, upper, 0))));
console.log(firstLine(() => show(grow(8, ownPost(8), tags, upper, 0))));
console.log(firstLine(() => show(grow(9, null, tags, upper, 0))));
console.log(firstLine(() => show(grow(10.5, author, tags, upper, 0))));
console.log(firstLine(() => show(grow("11", author, tags, upper, 0))));
console.log(firstLine(() => show(grow(12, author, tags, String, 0))));
class Shelf extends Array<string> {}
console.log(firstLine(() => show(grow(13, author, Shelf.from(["s"]), upper, Shelf.prototype))));
console.log(firstLine(() => show(grow(14, author, tags, upper, Symbol.iterator))));
console.log(firstLine(() => show(grow(15, author, tags, upper, 15n))));
