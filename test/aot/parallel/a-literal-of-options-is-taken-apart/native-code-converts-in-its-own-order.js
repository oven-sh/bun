// The headers are read first, then the status, then the text, then the body, whatever the order of the literal.
// STATISTIC: LiteralArgumentsScalarized >= 1
const told = [];
function answer(turn) {
  const status = { valueOf() { told.push("status"); return 200 + turn; } };
  const statusText = { toString() { told.push("statusText"); return "Text " + turn; } };
  const headers = { get a() { told.push("headers.a"); return { toString() { told.push("value of a"); return "1"; } }; } };
  const body = { toString() { told.push("body"); return "b"; } };
  return new Response(body, { status, statusText, headers });
}
for (let turn = 0; turn < 3; turn++) {
  const made = answer(turn);
  console.log(told.splice(0).join(", "), "|", made.status, made.statusText, [...made.headers].join("|"));
}
