// The value is serialized first, then the headers are read, then the status, then the text.
// STATISTIC: LiteralArgumentsScalarized >= 1
const told = [];
function answer(value, status, statusText, headers) {
  return Response.json(value, { status, statusText, headers });
}
const spy = (name, answer) => ({ valueOf() { told.push(name); return answer; }, toString() { told.push(name); return String(answer); } });
const throws = name => ({ valueOf() { told.push(name); throw new Error("from " + name); }, toString() { told.push(name); throw new Error("from " + name); } });
const value = { toJSON() { told.push("value"); return { a: 1 }; } };
const throwingValue = { toJSON() { told.push("value"); throw new Error("from value"); } };
const headers = { get a() { told.push("headers"); return "1"; } };
const cases = [
  [value, spy("status", 201), spy("statusText", "Text"), headers],
  [throwingValue, throws("status"), throws("statusText"), headers],
  [undefined, 99, "x", headers], [() => {}, 99, "x", headers], [Symbol("s"), 99, "x", headers], [10n, 99, "x", headers],
  [value, 99, throws("statusText"), headers], [value, throws("status"), "x", headers], [value, 200, throws("statusText"), headers],
  [value, 600, "x", {}], [value, undefined, undefined, undefined], [value, 204, "", []], [value, "205", null, new Headers({ b: "2" })],
  [value, 200, "x", { "bad name": "x" }], [value, 200, "x", null], [value, 200, "x", 5],
];
for (let turn = 0; turn < 2; turn++) {
  for (const [body, status, statusText, list] of cases) {
    try {
      const made = answer(body, status, statusText, list);
      console.log("made", made.status, JSON.stringify(made.statusText), [...made.headers].join("|"), told.splice(0).join(","), await made.text());
    } catch (error) {
      console.log(error.constructor.name, error.message, told.splice(0).join(","));
    }
  }
}
