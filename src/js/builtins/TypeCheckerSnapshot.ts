type Snapshot = import("bun").TypeCheckerSnapshot;

$overriddenName = "dispose";
export function dispose(this: Snapshot) {
  this[Symbol.dispose]();
}
