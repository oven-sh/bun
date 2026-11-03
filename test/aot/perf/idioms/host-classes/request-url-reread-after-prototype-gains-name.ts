import { nextTurns } from "../host.ts";
function bench(request: Request, n: number) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += request.url.length;
  }
  return s;
}
const subject = new Request("http://example.com/a/b?c=d");
let check = bench(subject, 10);
const ancestor = {};
const heir = Object.create(ancestor);
check += Object.keys(heir).length;
Object.defineProperty(ancestor, "url", { get: () => "of another object", configurable: true });
check += heir.url.length;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(subject, n);
console.log(check);
