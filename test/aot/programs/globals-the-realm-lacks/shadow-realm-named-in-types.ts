// BUN_JSC_useShadowRealm=0 takes the global ShadowRealm away. The types of the program still name the class, and code tests values against them.
declare class ShadowRealm {
  evaluate(text: string): unknown;
}
function make(): ShadowRealm | undefined {
  return typeof ShadowRealm === "function" ? new ShadowRealm() : undefined;
}
function isRealm(value: unknown): value is ShadowRealm {
  return typeof ShadowRealm !== "undefined" && value instanceof ShadowRealm;
}
function kindOf(realm: ShadowRealm | undefined): string {
  return realm === undefined ? "none" : typeof realm.evaluate;
}
let line = "";
for (let round = 0; round < 50; round++) line = kindOf(make()) + " " + isRealm(make()) + " " + isRealm({});
console.log(line);
