// new Response(body, { status, headers }): the literal is taken apart and never made.
// Sizes: 1000 4000 16000
// Passes: 68
// Grows: linear
// STATISTIC: LiteralArgumentsTakenApart >= 1
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function answer(body: string, status: number, headers: Headers): Response {
  return new Response(body, { status, headers });
}
function once(): string {
  const headers = new Headers({ "content-type": "text/plain" });
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const made = answer("body", 200 + (i % 100), headers);
    sum += made.status + (made.headers.has("content-type") ? 1 : 0);
  }
  return String(sum);
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
