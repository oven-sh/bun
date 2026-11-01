// `#name in value` throws a TypeError unless the value is an object, whatever the type of the value says.
function attempt(name: string, run: () => unknown) {
  try {
    console.log(name, run());
  } catch (error) {
    console.log(name, error instanceof TypeError ? "TypeError" : String(error));
  }
}
class Keeper {
  static #secret() {
    return 1;
  }
  static has(given: any) {
    const held: object | null = given;
    if (held !== null && held !== undefined) return #secret in held;
    return "none";
  }
  static hasTruthy(given: any) {
    const held: object = given;
    return held ? #secret in held : "none";
  }
  static hasCast(given: unknown) {
    return #secret in (given as object);
  }
  static hasMember(holder: { held: object }) {
    const held = holder.held;
    return held ? #secret in held : "none";
  }
}
for (const value of [Keeper, {}, null, undefined, 5, "s", true, 5n, Symbol.iterator] as any[]) {
  const label = typeof value + " " + (typeof value === "function" ? "Keeper" : String(value));
  attempt("has " + label, () => Keeper.has(value));
  attempt("hasTruthy " + label, () => Keeper.hasTruthy(value));
  attempt("hasCast " + label, () => Keeper.hasCast(value));
  attempt("hasMember " + label, () => Keeper.hasMember({ held: value }));
}
