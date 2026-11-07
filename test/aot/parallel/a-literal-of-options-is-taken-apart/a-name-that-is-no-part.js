// STATISTIC: LiteralArgumentsTakenApart = 0
const told = [];
const spy = name => ({ toString() { told.push(name); return "GET"; } });
function withMethod(status) { return new Response("b", { status, method: spy("method") }); }
function withOther(status) { return new Response("b", { status, url: spy("url"), body: spy("body"), type: spy("type") }); }
function withSymbol(status) { return new Response("b", { status, [Symbol.iterator]: spy("iterator") }); }
function withIndex(status) { return new Response("b", { status, 0: spy("zero") }); }
for (let turn = 0; turn < 3; turn++) {
  for (const make of [withMethod, withOther, withSymbol, withIndex]) {
    try {
      console.log(make(200 + turn).status, told.splice(0).join(","));
    } catch (error) {
      console.log(error.constructor.name, error.message, told.splice(0).join(","));
    }
  }
}
