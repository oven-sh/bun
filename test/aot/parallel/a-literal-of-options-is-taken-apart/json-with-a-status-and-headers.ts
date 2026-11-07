// STATISTIC: LiteralArgumentsTakenApart >= 3
function answer(value: unknown, status: number, headers: Record<string, string>): Response {
  return Response.json(value, { status, headers });
}
const failed = (value: unknown) => Response.json(value, { status: 400 });
function withAll(value: unknown, status: number, statusText: string, headers: Headers) {
  return Response.json(value, { headers, statusText, status });
}
const shared = new Headers({ "x-a": "1" });
for (let turn = 0; turn < 3; turn++) {
  for (const made of [answer({ turn, list: [1, "two"] }, 200 + turn, { "x-turn": "t" + turn }), answer([turn], 201, { "content-type": "mine/own" }), failed({ error: "no" }), withAll(null, 210 + turn, "Text", shared)])
    console.log(made.status, JSON.stringify(made.statusText), [...made.headers].join("|"), await made.text());
}
