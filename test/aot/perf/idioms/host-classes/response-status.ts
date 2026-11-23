import { nextTurns } from "../host.ts";
function bench(response: Response, n: number) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += response.status;
  }
  return s;
}
const subject = new Response("x", { status: 201 });
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(subject, n);
console.log(check);
