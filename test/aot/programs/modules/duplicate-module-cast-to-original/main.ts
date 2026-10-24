// The program has two copies of one module. Each declares a class with the same name and a private member, and an accessor returns either namespace cast to the first copy's type. Instances created from the returned class behave as in plain Bun.
function live(given: { token: string } | undefined): string | undefined {
  return given?.token;
}
async function refresh(generation: number, name: string): Promise<string | undefined> {
  const { keeperModule } = await import("./pick.ts");
  const { Keeper, describe } = keeperModule(generation);
  const keeper = new Keeper(name, { url: "u" });
  return describe(keeper) + " " + live(await keeper.tokens());
}
console.log(await refresh(1, "n"), "|", await refresh(1, ""));
console.log(await refresh(2, "n"), "|", await refresh(2, ""));
