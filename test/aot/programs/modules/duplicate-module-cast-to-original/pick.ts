export function keeperModule(generation: number): typeof import("./keeper.ts") {
  if (generation === 2) {
    return require("./v2/keeper.ts") as typeof import("./keeper.ts");
  }
  return require("./keeper.ts") as typeof import("./keeper.ts");
}
