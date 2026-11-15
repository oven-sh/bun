// `bun run` drops an `if` that holds nothing where its test only reads a member of a built-in object: the member is not read, so it is listed at its place among the rest.
// A test that does more stays, and with it every read in it.
if (Reflect.has) {}
if (Reflect.get);
if (Reflect.set) {} else {}
function inside() {
  if (Reflect.ownKeys) {}
}
inside();
if ((Reflect.apply, inside())) {}
if (Reflect.construct) inside();
Object.entries(Reflect);
console.log(Reflect.ownKeys(Reflect).map(String).join());
