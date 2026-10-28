// The key is an argument of the process if there is one, and otherwise a name that the program writes. Each road to Bun names a member of its own.
const key = name => process.argv[9] ?? name;

async function show(road, use) {
  try {
    console.log(road, await use());
  } catch (error) {
    console.log(road, "threw", error.name);
  }
}

await show("a list", () => [Bun].at(0)[key("peek")](Promise.resolve(3)));
await show("a map", () => typeof new (new Map([["bun", Bun]]).get("bun")[key("SQL")])("postgres://127.0.0.1:1/x"));
await show("an object below Bun", () => Object.create(Bun)[key("$")].braces("{a,b}"));
await show("a copy", () => typeof { ...Bun }[key("sql")].begin);
await show("Reflect.get", async () => typeof Reflect.get((await Promise.all([Bun]))[0], key("postgres")).begin);
