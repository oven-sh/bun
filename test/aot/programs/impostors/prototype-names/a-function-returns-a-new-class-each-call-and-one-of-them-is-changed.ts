// One class expression is evaluated many times: each evaluation has a prototype object of its own, and all share the compiled code.
// The prototype of one evaluation gets the name; its instances must inherit, the instances of the others must not. A class evaluated after the change starts clean.
interface Model {
  id: number;
  cached?: number;
}
type ModelClass = new (id: number) => Model;
const log: string[] = [];
function defineModel(): ModelClass {
  return class implements Model {
    declare id: number;
    declare cached?: number;
    constructor(id: number) {
      this.id = id;
    }
  };
}
function read(model: Model) {
  return model.cached;
}
function remember(model: Model) {
  return (model.cached ??= model.id * 3);
}
function state(model: Model) {
  return `${read(model)} ${"cached" in model} [${Object.keys(model)}]`;
}

const classes: ModelClass[] = [];
for (let i = 0; i < 6; i++) classes.push(defineModel());
let sum = 0;
for (let i = 0; i < 3000; i++) {
  const model = new classes[i % 6](i & 7);
  sum += read(model) ?? 1;
  if (i & 1) sum += remember(model);
}
console.log("warm", sum);

const old = classes.map((C, index) => new C(index));
classes[2].prototype["cach" + "ed"] = 222;
Object.defineProperty(classes[4].prototype, "cached", {
  get() {
    return undefined;
  },
  set(this: Model, value: number) {
    log.push(`set ${value} on ${this.id}`);
  },
  configurable: true,
});
const later = defineModel();
classes.push(later);
old.push(new later(6));
console.log("old instances:", old.map(state).join(" | "));
console.log("new instances:", classes.map((C, index) => state(new C(index))).join(" | "));
console.log("remember:", old.map(remember).join(), "|", log.join(", "));
console.log("old instances:", old.map(state).join(" | "));
sum = 0;
for (let i = 0; i < 3000; i++) {
  const model = new classes[i % 7](i & 7);
  sum += read(model) ?? 1;
  if (i & 1) sum += remember(model) ?? 0;
}
console.log("mixed", sum, log.length);
for (let i = 0; i < 2000; i++) {
  const C = defineModel();
  if (i % 500 === 0) C.prototype.cached = i;
  const model = new C(i);
  if (i % 250 === 0) console.log("evaluation", i, state(model), remember(model));
}
