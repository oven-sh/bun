// Impostors probe, one probe of many. It prints what plain Bun prints.
function* count(n) { for (let i = 0; i < n; i++) { const sent = yield i; if (sent) console.log("sent", sent); } return "end"; }
const it = count(3); console.log(it.next().value, it.next("x").value, [...count(2)].join());
const { a, ...rest } = { a: 1, b: 2, c: 3 }; console.log(a, JSON.stringify(rest), JSON.stringify(JSON.parse('{"k":[1,{"z":null}]}')));
