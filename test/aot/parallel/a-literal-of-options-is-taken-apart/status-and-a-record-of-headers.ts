// STATISTIC: LiteralArgumentsScalarized >= 1
function answer(body: string, status: number, headers: Record<string, string>): Response {
  return new Response(body, { status, headers });
}
for (let turn = 0; turn < 4; turn++) {
  const made = answer("body " + turn, 200 + turn, { "x-turn": "t" + turn, "content-type": "text/plain" });
  console.log(made.status, JSON.stringify(made.statusText), made.ok, [...made.headers].join("|"), await made.text());
}
