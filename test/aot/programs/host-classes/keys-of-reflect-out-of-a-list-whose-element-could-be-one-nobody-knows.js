// Reads a member of Reflect where only a test takes the value, then walks a list of one element: Reflect, or a member of the global object.
if (!Reflect.set) console.log("none");
for (const object of [Date.now() < 5 ? globalThis[String(Date.now())] : Reflect]) {
  const entries = Object.entries(object);
  console.log(entries.length, Reflect.ownKeys(object).map(String).join());
}
