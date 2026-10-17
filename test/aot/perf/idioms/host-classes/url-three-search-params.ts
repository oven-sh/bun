import { nextTurns } from "../host.ts";
function bench(texts: string[], n: number) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const query = new URL(texts[i & 3]).searchParams;
    s += query.get("page")!.length + query.get("limit")!.length + query.get("sort")!.length;
  }
  return s;
}
const subject = [
  "http://127.0.0.1:3000/users/7/posts/9?page=2&limit=10&sort=old",
  "http://127.0.0.1:3000/users/8/posts/10?page=3&limit=20&sort=new",
  "http://127.0.0.1:3000/users/9/posts/11?page=4&limit=30&sort=top",
  "http://127.0.0.1:3000/users/10/posts/12?page=5&limit=40&sort=hot",
];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(subject, n);
console.log(check);
