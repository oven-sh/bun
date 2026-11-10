// `bun <file>` and an executable of `bun build` leave all of such a statement out, so nothing throws from the dead zone.
function show(label, run) {
  try {
    console.log(label, "returned", run());
  } catch (error) {
    console.log(label, error.name);
  }
}
show("under typeof", () => { typeof inner; let inner; return 1; });
show("in a list", () => { [inner]; let inner; return 1; });
show("in a list behind holes", () => { [, , inner]; let inner; return 1; });
show("in a list in a list", () => { [[inner], 1]; let inner; return 1; });
show("in an object", () => { ({ a: inner }); let inner; return 1; });
show("in short in an object", () => { ({ inner }); let inner; return 1; });
show("beside a method", () => { ({ a: inner, m() {}, get g() { return 1; } }); let inner; return 1; });
show("spread into a list", () => { [...inner]; let inner; return 1; });
show("spread into an object", () => { ({ ...inner }); let inner; return 1; });
show("as a computed key", () => { ({ [inner]: 1 }); let inner; return 1; });
show("a list that is taken", () => { const list = [inner]; let inner; return list.length; });
show("typeof that is taken", () => { const kind = typeof inner; let inner; return kind; });
show("typeof a free name", () => { typeof nobodyDeclaresThis; return 1; });
