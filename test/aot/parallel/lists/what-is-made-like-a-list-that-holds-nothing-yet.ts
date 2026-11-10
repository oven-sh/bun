// Lists that hold nothing yet, of any length, under the methods that make a list like their receiver; with a species, a subclass and a changed constructor beside them
const log: string[] = [];
function tell(label: string, make: () => unknown) {
  try {
    const list = make();
    log.push(label + ": " + JSON.stringify(list) + " " + (list as unknown[]).length + " " + Object.keys(list as object).join() + " " + Object.getPrototypeOf(list)?.constructor?.name);
  } catch (error) {
    log.push(label + " threw " + (error as Error).constructor.name);
  }
}
function under(label: string, make: () => any[]) {
  tell(label + " map", () => make().map((value, index) => index));
  tell(label + " filter", () => make().filter(() => true));
  tell(label + " slice", () => make().slice());
  tell(label + " slice(1)", () => make().slice(1));
  tell(label + " concat", () => make().concat([1], make()));
  tell(label + " splice", () => make().splice(0, 2));
  tell(label + " flat", () => make().flat());
  tell(label + " flatMap", () => make().flatMap(value => [value, value]));
  tell(label + " grown", () => {
    const grown = make().map(value => value);
    grown.push("pushed", 1.5);
    return grown;
  });
}
for (let turn = 0; turn < 3; turn++) {
  log.length = 0;
  under("parsed", () => JSON.parse("[]"));
  under("keys", () => Object.keys({}));
  under("of a length", () => new Array(3));
  under("of a long length", () => new Array(200));
  under("emptied", () => { const list = JSON.parse("[1,2]"); list.length = 0; return list; });
  under("holes parsed then stretched", () => { const list = JSON.parse("[]"); list.length = 4; return list; });
  class Shelf extends Array {}
  under("a subclass", () => new Shelf());
  under("a species", () => { const list = JSON.parse("[]"); list.constructor = { [Symbol.species]: Shelf }; return list; });
  under("no constructor", () => { const list = JSON.parse("[]"); list.constructor = undefined; return list; });
  under("frozen", () => Object.freeze(JSON.parse("[]")) as any[]);
  under("with a name", () => Object.assign(JSON.parse("[]"), { extra: 1 }));
}
console.log(log.join("\n"));
