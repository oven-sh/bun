import { nextTurns } from "../host.ts";
function bench(request: Request, n: number) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += request.method.length;
  }
  return s;
}
const subject = new Request("http://example.com/a/b?c=d");
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(subject, n);
console.log(check);
