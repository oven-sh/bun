// Closures that make closures are made in five places and all of them are called in one reader. Two of the places run often and the others run once.
// Each closure still answers the variable of the turn that it was made in: for every kind of reader and every road that leads to it.
type Made = () => () => number;
function declared(thing: Made) {
  return thing()();
}
const arrow = (thing: Made) => thing()();
const bound = function (this: unknown, thing: Made) {
  return thing()();
}.bind(null);
const readers = {
  read(thing: Made) {
    return thing()();
  },
};
class Reads {
  static read(thing: Made) {
    return thing()();
  }
  with(thing: Made) {
    return thing()();
  }
}
const reads = new Reads();
function declared_called_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(declared(thing));
  return seen.join();
}
function declared_called_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function declared_called_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push(declared(thing));
  return seen.join();
}
function declared_called_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(declared(thing));
  return seen.join();
}
function declared_called_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(declared(thing));
  return seen.join();
}
class declared_called_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(declared(thing));
  return seen.join();
  }
}
console.log("declared called", declared_called_first(3), declared_called_second(3), new declared_called_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(declared_called_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(declared_called_reads(declared_called_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function declared_byCall_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(declared.call(undefined, thing));
  return seen.join();
}
function declared_byCall_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function declared_byCall_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push(declared.call(undefined, thing));
  return seen.join();
}
function declared_byCall_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(declared.call(undefined, thing));
  return seen.join();
}
function declared_byCall_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(declared.call(undefined, thing));
  return seen.join();
}
class declared_byCall_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(declared.call(undefined, thing));
  return seen.join();
  }
}
console.log("declared byCall", declared_byCall_first(3), declared_byCall_second(3), new declared_byCall_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(declared_byCall_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(declared_byCall_reads(declared_byCall_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function declared_byApply_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(declared.apply(undefined, [thing]));
  return seen.join();
}
function declared_byApply_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function declared_byApply_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push(declared.apply(undefined, [thing]));
  return seen.join();
}
function declared_byApply_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(declared.apply(undefined, [thing]));
  return seen.join();
}
function declared_byApply_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(declared.apply(undefined, [thing]));
  return seen.join();
}
class declared_byApply_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(declared.apply(undefined, [thing]));
  return seen.join();
  }
}
console.log("declared byApply", declared_byApply_first(3), declared_byApply_second(3), new declared_byApply_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(declared_byApply_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(declared_byApply_reads(declared_byApply_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function declared_byReflect_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(declared, undefined, [thing]));
  return seen.join();
}
function declared_byReflect_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function declared_byReflect_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(declared, undefined, [thing]));
  return seen.join();
}
function declared_byReflect_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(declared, undefined, [thing]));
  return seen.join();
}
function declared_byReflect_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(declared, undefined, [thing]));
  return seen.join();
}
class declared_byReflect_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(declared, undefined, [thing]));
  return seen.join();
  }
}
console.log("declared byReflect", declared_byReflect_first(3), declared_byReflect_second(3), new declared_byReflect_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(declared_byReflect_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(declared_byReflect_reads(declared_byReflect_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function declared_byMap_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(declared)[0]);
  return seen.join();
}
function declared_byMap_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function declared_byMap_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(declared)[0]);
  return seen.join();
}
function declared_byMap_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(declared)[0]);
  return seen.join();
}
function declared_byMap_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(declared)[0]);
  return seen.join();
}
class declared_byMap_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(declared)[0]);
  return seen.join();
  }
}
console.log("declared byMap", declared_byMap_first(3), declared_byMap_second(3), new declared_byMap_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(declared_byMap_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(declared_byMap_reads(declared_byMap_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function arrow_called_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(arrow(thing));
  return seen.join();
}
function arrow_called_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function arrow_called_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push(arrow(thing));
  return seen.join();
}
function arrow_called_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(arrow(thing));
  return seen.join();
}
function arrow_called_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(arrow(thing));
  return seen.join();
}
class arrow_called_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(arrow(thing));
  return seen.join();
  }
}
console.log("arrow called", arrow_called_first(3), arrow_called_second(3), new arrow_called_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(arrow_called_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(arrow_called_reads(arrow_called_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function arrow_byCall_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(arrow.call(undefined, thing));
  return seen.join();
}
function arrow_byCall_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function arrow_byCall_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push(arrow.call(undefined, thing));
  return seen.join();
}
function arrow_byCall_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(arrow.call(undefined, thing));
  return seen.join();
}
function arrow_byCall_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(arrow.call(undefined, thing));
  return seen.join();
}
class arrow_byCall_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(arrow.call(undefined, thing));
  return seen.join();
  }
}
console.log("arrow byCall", arrow_byCall_first(3), arrow_byCall_second(3), new arrow_byCall_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(arrow_byCall_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(arrow_byCall_reads(arrow_byCall_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function arrow_byApply_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(arrow.apply(undefined, [thing]));
  return seen.join();
}
function arrow_byApply_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function arrow_byApply_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push(arrow.apply(undefined, [thing]));
  return seen.join();
}
function arrow_byApply_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(arrow.apply(undefined, [thing]));
  return seen.join();
}
function arrow_byApply_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(arrow.apply(undefined, [thing]));
  return seen.join();
}
class arrow_byApply_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(arrow.apply(undefined, [thing]));
  return seen.join();
  }
}
console.log("arrow byApply", arrow_byApply_first(3), arrow_byApply_second(3), new arrow_byApply_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(arrow_byApply_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(arrow_byApply_reads(arrow_byApply_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function arrow_byReflect_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(arrow, undefined, [thing]));
  return seen.join();
}
function arrow_byReflect_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function arrow_byReflect_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(arrow, undefined, [thing]));
  return seen.join();
}
function arrow_byReflect_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(arrow, undefined, [thing]));
  return seen.join();
}
function arrow_byReflect_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(arrow, undefined, [thing]));
  return seen.join();
}
class arrow_byReflect_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(arrow, undefined, [thing]));
  return seen.join();
  }
}
console.log("arrow byReflect", arrow_byReflect_first(3), arrow_byReflect_second(3), new arrow_byReflect_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(arrow_byReflect_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(arrow_byReflect_reads(arrow_byReflect_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function arrow_byMap_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(arrow)[0]);
  return seen.join();
}
function arrow_byMap_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function arrow_byMap_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(arrow)[0]);
  return seen.join();
}
function arrow_byMap_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(arrow)[0]);
  return seen.join();
}
function arrow_byMap_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(arrow)[0]);
  return seen.join();
}
class arrow_byMap_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(arrow)[0]);
  return seen.join();
  }
}
console.log("arrow byMap", arrow_byMap_first(3), arrow_byMap_second(3), new arrow_byMap_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(arrow_byMap_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(arrow_byMap_reads(arrow_byMap_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function bound_called_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(bound(thing));
  return seen.join();
}
function bound_called_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function bound_called_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push(bound(thing));
  return seen.join();
}
function bound_called_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(bound(thing));
  return seen.join();
}
function bound_called_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(bound(thing));
  return seen.join();
}
class bound_called_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(bound(thing));
  return seen.join();
  }
}
console.log("bound called", bound_called_first(3), bound_called_second(3), new bound_called_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(bound_called_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(bound_called_reads(bound_called_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function bound_byCall_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(bound.call(undefined, thing));
  return seen.join();
}
function bound_byCall_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function bound_byCall_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push(bound.call(undefined, thing));
  return seen.join();
}
function bound_byCall_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(bound.call(undefined, thing));
  return seen.join();
}
function bound_byCall_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(bound.call(undefined, thing));
  return seen.join();
}
class bound_byCall_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(bound.call(undefined, thing));
  return seen.join();
  }
}
console.log("bound byCall", bound_byCall_first(3), bound_byCall_second(3), new bound_byCall_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(bound_byCall_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(bound_byCall_reads(bound_byCall_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function bound_byApply_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(bound.apply(undefined, [thing]));
  return seen.join();
}
function bound_byApply_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function bound_byApply_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push(bound.apply(undefined, [thing]));
  return seen.join();
}
function bound_byApply_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(bound.apply(undefined, [thing]));
  return seen.join();
}
function bound_byApply_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(bound.apply(undefined, [thing]));
  return seen.join();
}
class bound_byApply_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(bound.apply(undefined, [thing]));
  return seen.join();
  }
}
console.log("bound byApply", bound_byApply_first(3), bound_byApply_second(3), new bound_byApply_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(bound_byApply_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(bound_byApply_reads(bound_byApply_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function bound_byReflect_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(bound, undefined, [thing]));
  return seen.join();
}
function bound_byReflect_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function bound_byReflect_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(bound, undefined, [thing]));
  return seen.join();
}
function bound_byReflect_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(bound, undefined, [thing]));
  return seen.join();
}
function bound_byReflect_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(bound, undefined, [thing]));
  return seen.join();
}
class bound_byReflect_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(bound, undefined, [thing]));
  return seen.join();
  }
}
console.log("bound byReflect", bound_byReflect_first(3), bound_byReflect_second(3), new bound_byReflect_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(bound_byReflect_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(bound_byReflect_reads(bound_byReflect_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function bound_byMap_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(bound)[0]);
  return seen.join();
}
function bound_byMap_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function bound_byMap_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(bound)[0]);
  return seen.join();
}
function bound_byMap_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(bound)[0]);
  return seen.join();
}
function bound_byMap_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(bound)[0]);
  return seen.join();
}
class bound_byMap_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(bound)[0]);
  return seen.join();
  }
}
console.log("bound byMap", bound_byMap_first(3), bound_byMap_second(3), new bound_byMap_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(bound_byMap_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(bound_byMap_reads(bound_byMap_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function ofAnObject_called_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(readers.read(thing));
  return seen.join();
}
function ofAnObject_called_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function ofAnObject_called_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push(readers.read(thing));
  return seen.join();
}
function ofAnObject_called_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(readers.read(thing));
  return seen.join();
}
function ofAnObject_called_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(readers.read(thing));
  return seen.join();
}
class ofAnObject_called_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(readers.read(thing));
  return seen.join();
  }
}
console.log("ofAnObject called", ofAnObject_called_first(3), ofAnObject_called_second(3), new ofAnObject_called_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(ofAnObject_called_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(ofAnObject_called_reads(ofAnObject_called_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function ofAnObject_byCall_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(readers.read.call(undefined, thing));
  return seen.join();
}
function ofAnObject_byCall_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function ofAnObject_byCall_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push(readers.read.call(undefined, thing));
  return seen.join();
}
function ofAnObject_byCall_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(readers.read.call(undefined, thing));
  return seen.join();
}
function ofAnObject_byCall_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(readers.read.call(undefined, thing));
  return seen.join();
}
class ofAnObject_byCall_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(readers.read.call(undefined, thing));
  return seen.join();
  }
}
console.log("ofAnObject byCall", ofAnObject_byCall_first(3), ofAnObject_byCall_second(3), new ofAnObject_byCall_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(ofAnObject_byCall_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(ofAnObject_byCall_reads(ofAnObject_byCall_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function ofAnObject_byApply_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(readers.read.apply(undefined, [thing]));
  return seen.join();
}
function ofAnObject_byApply_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function ofAnObject_byApply_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push(readers.read.apply(undefined, [thing]));
  return seen.join();
}
function ofAnObject_byApply_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(readers.read.apply(undefined, [thing]));
  return seen.join();
}
function ofAnObject_byApply_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(readers.read.apply(undefined, [thing]));
  return seen.join();
}
class ofAnObject_byApply_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(readers.read.apply(undefined, [thing]));
  return seen.join();
  }
}
console.log("ofAnObject byApply", ofAnObject_byApply_first(3), ofAnObject_byApply_second(3), new ofAnObject_byApply_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(ofAnObject_byApply_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(ofAnObject_byApply_reads(ofAnObject_byApply_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function ofAnObject_byReflect_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(readers.read, undefined, [thing]));
  return seen.join();
}
function ofAnObject_byReflect_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function ofAnObject_byReflect_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(readers.read, undefined, [thing]));
  return seen.join();
}
function ofAnObject_byReflect_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(readers.read, undefined, [thing]));
  return seen.join();
}
function ofAnObject_byReflect_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(readers.read, undefined, [thing]));
  return seen.join();
}
class ofAnObject_byReflect_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(readers.read, undefined, [thing]));
  return seen.join();
  }
}
console.log("ofAnObject byReflect", ofAnObject_byReflect_first(3), ofAnObject_byReflect_second(3), new ofAnObject_byReflect_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(ofAnObject_byReflect_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(ofAnObject_byReflect_reads(ofAnObject_byReflect_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function ofAnObject_byMap_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(readers.read)[0]);
  return seen.join();
}
function ofAnObject_byMap_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function ofAnObject_byMap_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(readers.read)[0]);
  return seen.join();
}
function ofAnObject_byMap_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(readers.read)[0]);
  return seen.join();
}
function ofAnObject_byMap_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(readers.read)[0]);
  return seen.join();
}
class ofAnObject_byMap_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(readers.read)[0]);
  return seen.join();
  }
}
console.log("ofAnObject byMap", ofAnObject_byMap_first(3), ofAnObject_byMap_second(3), new ofAnObject_byMap_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(ofAnObject_byMap_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(ofAnObject_byMap_reads(ofAnObject_byMap_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function ofAClass_called_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reads.read(thing));
  return seen.join();
}
function ofAClass_called_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function ofAClass_called_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push(Reads.read(thing));
  return seen.join();
}
function ofAClass_called_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reads.read(thing));
  return seen.join();
}
function ofAClass_called_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reads.read(thing));
  return seen.join();
}
class ofAClass_called_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reads.read(thing));
  return seen.join();
  }
}
console.log("ofAClass called", ofAClass_called_first(3), ofAClass_called_second(3), new ofAClass_called_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(ofAClass_called_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(ofAClass_called_reads(ofAClass_called_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function ofAClass_byCall_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reads.read.call(undefined, thing));
  return seen.join();
}
function ofAClass_byCall_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function ofAClass_byCall_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push(Reads.read.call(undefined, thing));
  return seen.join();
}
function ofAClass_byCall_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reads.read.call(undefined, thing));
  return seen.join();
}
function ofAClass_byCall_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reads.read.call(undefined, thing));
  return seen.join();
}
class ofAClass_byCall_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reads.read.call(undefined, thing));
  return seen.join();
  }
}
console.log("ofAClass byCall", ofAClass_byCall_first(3), ofAClass_byCall_second(3), new ofAClass_byCall_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(ofAClass_byCall_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(ofAClass_byCall_reads(ofAClass_byCall_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function ofAClass_byApply_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reads.read.apply(undefined, [thing]));
  return seen.join();
}
function ofAClass_byApply_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function ofAClass_byApply_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push(Reads.read.apply(undefined, [thing]));
  return seen.join();
}
function ofAClass_byApply_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reads.read.apply(undefined, [thing]));
  return seen.join();
}
function ofAClass_byApply_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reads.read.apply(undefined, [thing]));
  return seen.join();
}
class ofAClass_byApply_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reads.read.apply(undefined, [thing]));
  return seen.join();
  }
}
console.log("ofAClass byApply", ofAClass_byApply_first(3), ofAClass_byApply_second(3), new ofAClass_byApply_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(ofAClass_byApply_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(ofAClass_byApply_reads(ofAClass_byApply_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function ofAClass_byReflect_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(Reads.read, undefined, [thing]));
  return seen.join();
}
function ofAClass_byReflect_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function ofAClass_byReflect_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(Reads.read, undefined, [thing]));
  return seen.join();
}
function ofAClass_byReflect_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(Reads.read, undefined, [thing]));
  return seen.join();
}
function ofAClass_byReflect_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(Reads.read, undefined, [thing]));
  return seen.join();
}
class ofAClass_byReflect_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(Reads.read, undefined, [thing]));
  return seen.join();
  }
}
console.log("ofAClass byReflect", ofAClass_byReflect_first(3), ofAClass_byReflect_second(3), new ofAClass_byReflect_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(ofAClass_byReflect_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(ofAClass_byReflect_reads(ofAClass_byReflect_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function ofAClass_byMap_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(Reads.read)[0]);
  return seen.join();
}
function ofAClass_byMap_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function ofAClass_byMap_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(Reads.read)[0]);
  return seen.join();
}
function ofAClass_byMap_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(Reads.read)[0]);
  return seen.join();
}
function ofAClass_byMap_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(Reads.read)[0]);
  return seen.join();
}
class ofAClass_byMap_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(Reads.read)[0]);
  return seen.join();
  }
}
console.log("ofAClass byMap", ofAClass_byMap_first(3), ofAClass_byMap_second(3), new ofAClass_byMap_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(ofAClass_byMap_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(ofAClass_byMap_reads(ofAClass_byMap_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function ofAnInstance_called_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(reads.with(thing));
  return seen.join();
}
function ofAnInstance_called_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function ofAnInstance_called_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push(reads.with(thing));
  return seen.join();
}
function ofAnInstance_called_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(reads.with(thing));
  return seen.join();
}
function ofAnInstance_called_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(reads.with(thing));
  return seen.join();
}
class ofAnInstance_called_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(reads.with(thing));
  return seen.join();
  }
}
console.log("ofAnInstance called", ofAnInstance_called_first(3), ofAnInstance_called_second(3), new ofAnInstance_called_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(ofAnInstance_called_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(ofAnInstance_called_reads(ofAnInstance_called_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function ofAnInstance_byCall_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(reads.with.call(undefined, thing));
  return seen.join();
}
function ofAnInstance_byCall_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function ofAnInstance_byCall_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push(reads.with.call(undefined, thing));
  return seen.join();
}
function ofAnInstance_byCall_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(reads.with.call(undefined, thing));
  return seen.join();
}
function ofAnInstance_byCall_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(reads.with.call(undefined, thing));
  return seen.join();
}
class ofAnInstance_byCall_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(reads.with.call(undefined, thing));
  return seen.join();
  }
}
console.log("ofAnInstance byCall", ofAnInstance_byCall_first(3), ofAnInstance_byCall_second(3), new ofAnInstance_byCall_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(ofAnInstance_byCall_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(ofAnInstance_byCall_reads(ofAnInstance_byCall_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function ofAnInstance_byApply_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(reads.with.apply(undefined, [thing]));
  return seen.join();
}
function ofAnInstance_byApply_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function ofAnInstance_byApply_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push(reads.with.apply(undefined, [thing]));
  return seen.join();
}
function ofAnInstance_byApply_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(reads.with.apply(undefined, [thing]));
  return seen.join();
}
function ofAnInstance_byApply_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(reads.with.apply(undefined, [thing]));
  return seen.join();
}
class ofAnInstance_byApply_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(reads.with.apply(undefined, [thing]));
  return seen.join();
  }
}
console.log("ofAnInstance byApply", ofAnInstance_byApply_first(3), ofAnInstance_byApply_second(3), new ofAnInstance_byApply_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(ofAnInstance_byApply_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(ofAnInstance_byApply_reads(ofAnInstance_byApply_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function ofAnInstance_byReflect_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(reads.with, undefined, [thing]));
  return seen.join();
}
function ofAnInstance_byReflect_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function ofAnInstance_byReflect_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(reads.with, undefined, [thing]));
  return seen.join();
}
function ofAnInstance_byReflect_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(reads.with, undefined, [thing]));
  return seen.join();
}
function ofAnInstance_byReflect_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(reads.with, undefined, [thing]));
  return seen.join();
}
class ofAnInstance_byReflect_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push(Reflect.apply(reads.with, undefined, [thing]));
  return seen.join();
  }
}
console.log("ofAnInstance byReflect", ofAnInstance_byReflect_first(3), ofAnInstance_byReflect_second(3), new ofAnInstance_byReflect_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(ofAnInstance_byReflect_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(ofAnInstance_byReflect_reads(ofAnInstance_byReflect_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
function ofAnInstance_byMap_together(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(reads.with)[0]);
  return seen.join();
}
function ofAnInstance_byMap_makes(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  return made;
}
function ofAnInstance_byMap_reads(made: Made[]) {
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(reads.with)[0]);
  return seen.join();
}
function ofAnInstance_byMap_first(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(reads.with)[0]);
  return seen.join();
}
function ofAnInstance_byMap_second(n: number) {
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(reads.with)[0]);
  return seen.join();
}
class ofAnInstance_byMap_Holder {
  n = 3;
  run() {
  const n = this.n;
  const made: Made[] = [];
  for (let i = 0; i < n; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const thing of made) seen.push([thing].map(reads.with)[0]);
  return seen.join();
  }
}
console.log("ofAnInstance byMap", ofAnInstance_byMap_first(3), ofAnInstance_byMap_second(3), new ofAnInstance_byMap_Holder().run());
{
  const said = new Set<string>();
  for (let turn = 0; turn < 200; turn++) said.add(ofAnInstance_byMap_together(3 + (turn % 2)));
  for (let turn = 0; turn < 200; turn++) said.add(ofAnInstance_byMap_reads(ofAnInstance_byMap_makes(3 + (turn % 2))));
  console.log([...said].join(" | "));
}
export {};
