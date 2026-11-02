// return() of an async generator awaits its operand, and the body is resumed with what the await answers, to return it from where it stands.
function thenable(value) { return { then(resolve) { resolve(value); } }; }
function kind(v) { if (typeof v === "object") return "object"; return v === undefined ? "undefined" : "other " + v; }
async function main() {
  async function* generator() { const got = yield 1; console.log("sent", kind(got)); }
  const it = generator(); await it.next();
  console.log("return()", kind((await it.return(thenable("k"))).value));
  const it2 = generator(); await it2.next();
  const answer = await it2.return(thenable(21));
  console.log(answer.value === undefined ? "nothing" : answer.value + 1, answer.done);
  const it3 = generator(); await it3.next();
  const third = (await it3.return(thenable({ n: 5 }))).value;
  console.log(third.then === undefined ? "no thenable: " + third.n : "a thenable");
}
main().catch(e => console.log("failed", String(e)));
