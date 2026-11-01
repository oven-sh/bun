type Tag = { name: string; weight: number };
type User = { id: number; name: string; ok: boolean; tags: string[] };
type Post = { id: number; author: User; marks: Tag[]; note: string | null };
type Tree = { label: string; children: Tree[] };
type Even = { n: number; next: Odd | null };
type Odd = { n: number; next: Even | null };
type Settings = { port: number; host: string; debug: boolean };

function writeUser(user: User): string {
  return JSON.stringify(user);
}
function writePost(post: Post): string {
  return JSON.stringify(post);
}
function writeTree(tree: Tree): string {
  return JSON.stringify(tree);
}
function writeChain(first: Even): string {
  return JSON.stringify(first);
}
function writeRarely(user: User, turn: number): number {
  if (turn % 997 === 996) return JSON.stringify(user).length;
  return turn & 1;
}

const word = process.argv.length > 99 ? "never" : 'a "quoted" \n word';
const settings: Settings = { port: 8080 + word.length, host: word, debug: word.length > 3 };
console.log(JSON.stringify(settings));

const users: User[] = [];
for (let i = 0; i < 5; ++i) users.push({ id: i * 1000003, name: word + i, ok: i % 2 === 0, tags: i === 3 ? [] : [word, "t" + i] });

let length = 0;
let last = "";
for (let turn = 0; turn < 3000; ++turn) {
  const user = users[turn % users.length];
  user.id = turn % 7 === 0 ? turn + 0.5 : turn % 11 === 0 ? -turn : turn * 65537;
  last = writeUser(user);
  length += last.length + writeRarely(user, turn);
}
console.log(length, last);

const posts: Post[] = users.map((author, i) => ({
  id: i,
  author,
  marks: i === 1 ? [] : [{ name: "m" + i, weight: i / 4 }, { name: word, weight: -i }],
  note: i % 2 ? null : "note " + i,
}));
length = 0;
for (let turn = 0; turn < 2000; ++turn) {
  for (const post of posts) {
    post.id = turn;
    last = writePost(post);
    length += last.length;
  }
}
console.log(length, last);

function grow(depth: number, width: number): Tree {
  const children: Tree[] = [];
  if (depth > 0) for (let i = 0; i < width; ++i) children.push(grow(depth - 1, width - (i & 1)));
  return { label: "d" + depth + "w" + width, children };
}
const tree = grow(4, 3);
length = 0;
for (let turn = 0; turn < 300; ++turn) {
  tree.label = "root" + turn;
  last = writeTree(tree);
  length += last.length;
}
console.log(length, last.length, last.slice(0, 120));

let chain: Even = { n: 0, next: null };
for (let n = 19; n > 0; n -= 2) chain = { n: n - 1, next: { n, next: chain } };
length = 0;
for (let turn = 0; turn < 1000; ++turn) {
  chain.n = turn;
  last = writeChain(chain);
  length += last.length;
}
console.log(length, last);

const looped: Tree = { label: "loop", children: [] };
looped.children.push({ label: "inner", children: [looped] });
for (let turn = 0; turn < 3; ++turn) {
  try {
    console.log(writeTree(looped));
  } catch (error) {
    console.log(turn, (error as Error).name);
  }
}
console.log(writeTree(tree).length, writeUser(users[3]));
