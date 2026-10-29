// Prints where a stack trace places the name of a shorthand member that is read in front of its declaration, or that nothing declares.
function pass(value) {
  return value;
}
function fail() {
  throw new Error("fail");
}
function Made() {}
const nothing = null;
const missing = undefined;
const symbol = Symbol("symbol");
const holder = { a: null, f: 5, s: "text", arr: [1], nested: { deep: null }, g() { return { h: 1 }; } };
let five = 5;
let key = "nope";
const inThisFile = /stack-positions-shorthand-members-read/;
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
show("pass({ z }); let z = 1;", () => { pass({ z }); let z = 1; });
show("pass({ zz }); let zz = 1;", () => { pass({ zz }); let zz = 1; });
show("pass({ zzz }); let zzz = 1;", () => { pass({ zzz }); let zzz = 1; });
show("pass({ z, a: 1 }); let z = 1;", () => { pass({ z, a: 1 }); let z = 1; });
show("pass({ zz, a: 1 }); let zz = 1;", () => { pass({ zz, a: 1 }); let zz = 1; });
show("pass({ zzz, a: 1 }); let zzz = 1;", () => { pass({ zzz, a: 1 }); let zzz = 1; });
show("pass({ zzzz, a: 1 }); let zzzz = 1;", () => { pass({ zzzz, a: 1 }); let zzzz = 1; });
show("pass({ zzzzz, a: 1 }); let zzzzz = 1;", () => { pass({ zzzzz, a: 1 }); let zzzzz = 1; });
show("pass({ zzzzzz, a: 1 }); let zzzzzz = 1;", () => { pass({ zzzzzz, a: 1 }); let zzzzzz = 1; });
show("pass({ zzzzzzz, a: 1 }); let zzzzzzz = 1;", () => { pass({ zzzzzzz, a: 1 }); let zzzzzzz = 1; });
show("pass({ zzz, five }); let zzz = 1;", () => { pass({ zzz, five }); let zzz = 1; });
show("pass({ zzzzzzzz, five }); let zzzzzzzz = 1;", () => { pass({ zzzzzzzz, five }); let zzzzzzzz = 1; });
show("pass({ a: 1, zz }); let zz = 1;", () => { pass({ a: 1, zz }); let zz = 1; });
show("pass([{ zz }]); let zz = 1;", () => { pass([{ zz }]); let zz = 1; });
show("pass([{ zzz }]); let zzz = 1;", () => { pass([{ zzz }]); let zzz = 1; });
show("pass({ zz }, 1); let zz = 1;", () => { pass({ zz }, 1); let zz = 1; });
show("pass({ zzz }, 1); let zzz = 1;", () => { pass({ zzz }, 1); let zzz = 1; });
show("pass({ zzzz }, 1); let zzzz = 1;", () => { pass({ zzzz }, 1); let zzzz = 1; });
show("pass({ zzzzz }, 1); let zzzzz = 1;", () => { pass({ zzzzz }, 1); let zzzzz = 1; });
show("pass({ zzz }.x); let zzz = 1;", () => { pass({ zzz }.x); let zzz = 1; });
show("pass({ zzzz }.x); let zzzz = 1;", () => { pass({ zzzz }.x); let zzzz = 1; });
show("const each = { zz }; let zz = 1; pass(each, each);", () => { const each = { zz }; let zz = 1; pass(each, each); });
show("return { zz }; let zz = 1;", () => { return { zz }; let zz = 1; });
show("pass({ zzz } + 1); let zzz = 1;", () => { pass({ zzz } + 1); let zzz = 1; });
show("pass({ zzzzz } + 1); let zzzzz = 1;", () => { pass({ zzzzz } + 1); let zzzzz = 1; });
show("pass({ q: { zz } }); let zz = 1;", () => { pass({ q: { zz } }); let zz = 1; });
show("pass({ q: { zzzz } }); let zzzz = 1;", () => { pass({ q: { zzzz } }); let zzzz = 1; });
show("pass({ gc0 });", () => { pass({ gc0 }); });
show("pass(pass(\"Bun\", { gc0 }));", () => { pass(pass("Bun", { gc0 })); });
