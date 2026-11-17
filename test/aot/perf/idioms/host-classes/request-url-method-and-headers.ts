import { nextTurns } from "../host.ts";
function bench(request: Request, n: number) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += request.url.length + request.method.length; if (request.headers !== undefined) s++;
  }
  return s;
}
const subject = new Request("http://example.com/a/b?c=d", { headers: { a: "b" } });
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(subject, n);
console.log(check);
