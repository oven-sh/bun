// Prints where a stack trace places the call of a tag, what follows a tagged template, and a `new` without arguments whose result is kept in a variable that is used once.
function pass(value) {
  return value;
}
function fail() {
  throw new Error("fail");
}
function Made() {}
function Thrower() {
  throw new Error("Thrower");
}
const nothing = null;
const missing = undefined;
const symbol = Symbol("symbol");
const holder = { a: null, f: 5, s: "text", arr: [1], nested: { deep: null }, g() { return { h: 1 }; }, m() { throw new Error("m"); } };
let five = 5;
let key = "nope";
const inThisFile = /stack-positions-tagged-templates-objects/;
function placesOf(error) {
  return String(error.stack).split("\n").filter(line => inThisFile.test(line)).map(line => /:(\d+:\d+)\)?$/.exec(line)[1]);
}
function show(label, run) {
  try {
    run();
    console.log(label, "| no error");
  } catch (error) {
    console.log(label, "|", error.constructor.name, "|", placesOf(error).slice(0, -2).join(" "));
  }
}
async function showAsync(label, run) {
  try {
    await run();
    console.log(label, "| no error");
  } catch (error) {
    console.log(label, "|", error.constructor.name, "|", placesOf(error).join(" "));
  }
}
show("fail`a`;", () => { fail`a`; });
show("fail`a${1}b`;", () => { fail`a${1}b`; });
show("fail`a${five}b`;", () => { fail`a${five}b`; });
show("fail`a${five}b${key}c`;", () => { fail`a${five}b${key}c`; });
show("fail`${five}`;", () => { fail`${five}`; });
show("fail`a${pass(five)}b`;", () => { fail`a${pass(five)}b`; });
show("fail`a${holder.s}b`;", () => { fail`a${holder.s}b`; });
show("fail`a${holder.arr[0]}b`;", () => { fail`a${holder.arr[0]}b`; });
show("fail`a${five + 1}b`;", () => { fail`a${five + 1}b`; });
show("fail`a${1 + five}b`;", () => { fail`a${1 + five}b`; });
show("fail`a${[five]}b`;", () => { fail`a${[five]}b`; });
show("fail`a${{ five }}b`;", () => { fail`a${{ five }}b`; });
show("fail`a${() => five}b`;", () => { fail`a${() => five}b`; });
show("fail`a${`x${five}y`}b`;", () => { fail`a${`x${five}y`}b`; });
show("fail`a${\"s\"}b`;", () => { fail`a${"s"}b`; });
show("fail`a${five ? 1 : key}b`;", () => { fail`a${five ? 1 : key}b`; });
show("holder.m`a`;", () => { holder.m`a`; });
show("holder.m`a${five}b`;", () => { holder.m`a${five}b`; });
show("holder[\"m\"]`a${five}b`;", () => { holder["m"]`a${five}b`; });
show("holder.nested.deep`a`;", () => { holder.nested.deep`a`; });
show("holder.nested.deep`a${five}b`;", () => { holder.nested.deep`a${five}b`; });
show("n`a`;", () => { n`a`; });
show("n`a${five}b`;", () => { n`a${five}b`; });
show("five`a${five}b`;", () => { five`a${five}b`; });
show("pass(fail)`a${five}b`;", () => { pass(fail)`a${five}b`; });
show("pass(fail)`a`;", () => { pass(fail)`a`; });
show("(0, fail)`a${five}b`;", () => { (0, fail)`a${five}b`; });
show("pass(fail`a${five}b`);", () => { pass(fail`a${five}b`); });
show("const r = fail`a${five}b`; pass(r); pass(r);", () => { const r = fail`a${five}b`; pass(r); pass(r); });
show("fail`a${five}b`.x;", () => { fail`a${five}b`.x; });
show("id`a${five}b`.x.y;", () => { id`a${five}b`.x.y; });
show("id`a${five}b`();", () => { id`a${five}b`(); });
show("id`a`();", () => { id`a`(); });
show("id`a``b`;", () => { id`a``b`; });
show("new fail`a${five}b`;", () => { new fail`a${five}b`; });
show("String.raw`a${symbol}b`;", () => { String.raw`a${symbol}b`; });
show("String.raw`a${five}${symbol}`;", () => { String.raw`a${five}${symbol}`; });
show("fail`a${fail}b${  five  }c`;", () => { fail`a${fail}b${  five  }c`; });
show("fail`a${five /* c */}b`;", () => { fail`a${five /* c */}b`; });
show("fail`a${(five)}b`;", () => { fail`a${(five)}b`; });
show("const g = fail; g`a${five}b`;", () => { const g = fail; g`a${five}b`; });
show("const a = new pass(); a.x.y;", () => { const a = new pass(); a.x.y; });
show("const a = new Thrower(); a.x;", () => { const a = new Thrower(); a.x; });
show("const a = new Thrower(); a.x();", () => { const a = new Thrower(); a.x(); });
show("const a = new Thrower(); a[five];", () => { const a = new Thrower(); a[five]; });
show("const a = new Thrower(); a();", () => { const a = new Thrower(); a(); });
show("const a = new Thrower(); pass(a);", () => { const a = new Thrower(); pass(a); });
show("const a = new Thrower(); pass(a.x);", () => { const a = new Thrower(); pass(a.x); });
show("const a = new Thrower(); const b = five; a.run(b);", () => { const a = new Thrower(); const b = five; a.run(b); });
show("const a = new Thrower(); if (a.x) pass(1);", () => { const a = new Thrower(); if (a.x) pass(1); });
show("const a = new Thrower(); a`x`;", () => { const a = new Thrower(); a`x`; });
show("const a = new Thrower(); a.x = 1;", () => { const a = new Thrower(); a.x = 1; });
show("const a = new Thrower(); a.x++;", () => { const a = new Thrower(); a.x++; });
show("const a = new Thrower(); delete a.x;", () => { const a = new Thrower(); delete a.x; });
show("const a = new Thrower(); a?.x;", () => { const a = new Thrower(); a?.x; });
show("const a = new Thrower(); a + 1;", () => { const a = new Thrower(); a + 1; });
show("const a = new Thrower(); pass(1); a.x;", () => { const a = new Thrower(); pass(1); a.x; });
show("const a = new Thrower(); a.x; a.y;", () => { const a = new Thrower(); a.x; a.y; });
show("const a = new Thrower; a.x;", () => { const a = new Thrower; a.x; });
show("const a = new holder.m(); a.x;", () => { const a = new holder.m(); a.x; });
show("let a = new Thrower(), b = five; pass(b, a.x);", () => { let a = new Thrower(), b = five; pass(b, a.x); });
show("const a = new Thrower(1); a.x;", () => { const a = new Thrower(1); a.x; });
show("const a = (new Thrower()); a.x;", () => { const a = (new Thrower()); a.x; });
show("const a = new Thrower(); const b = a; b.x;", () => { const a = new Thrower(); const b = a; b.x; });
show("const a = new Thrower(); const b = a.x; pass(b);", () => { const a = new Thrower(); const b = a.x; pass(b); });
show("const a = new Thrower(); throw a.x;", () => { const a = new Thrower(); throw a.x; });
show("const a = new Thrower(); switch (a.x) { }", () => { const a = new Thrower(); switch (a.x) { } });
show("const a = new Thrower(); for (const b of a.x) pass(b);", () => { const a = new Thrower(); for (const b of a.x) pass(b); });
show("over several lines, a tagged template ends the function", () => {
  (function () {
    fail();
    return pass`first ${five}
      second ${
        key
      } third`;
  })();
});
show("over several lines, an object made for one use", () => {
  const made = new Thrower();
  made
    .first()
    .second();
});
await showAsync("const a = new Thrower(); await a.x;", async () => { const a = new Thrower(); await a.x; });
await showAsync("await fail`a${five}b`;", async () => { await fail`a${five}b`; });
