const plainPrototype = { tag: 1 };
const deepPrototype = Object.create(plainPrototype);
function Maker() { this.x = 1; }
const things = {
  created: Object.create(plainPrototype),
  deep: Object.create(deepPrototype),
  withFields: Object.assign(Object.create(plainPrototype), { x: 1 }),
  made: new Maker(),
  bare: Object.create(null),
};
const names = Object.keys(things).filter(name => name.length < process.argv.length + 99);
async function returns(value) { return value; }
async function show(label) {
  for (const name of names) {
    const thing = things[name];
    const results = [];
    for (let round = 0; round < 4; round++) {
      const result = await returns(thing);
      const awaited = await thing;
      const resolved = await Promise.resolve(thing);
      results.push([result, awaited, resolved].map(value => (value === thing ? "itself" : String(value))).join("/"));
    }
    console.log(label, name, results.join(" "));
  }
}
const then = text => function (resolve) { resolve(text); };

await show("at first");
plainPrototype.then = then("from the plain prototype");
await show("then on the plain prototype");
delete plainPrototype.then;
await show("deleted again");
deepPrototype.then = then("from the deep prototype");
Maker.prototype.then = then("from Maker.prototype");
await show("then on two others");
delete deepPrototype.then;
delete Maker.prototype.then;
Object.setPrototypeOf(plainPrototype, { then: then("from above") });
await show("another prototype above");
Object.setPrototypeOf(plainPrototype, Object.prototype);
things.created.then = then("own");
things.bare.then = then("own");
await show("own then");
