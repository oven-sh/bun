import * as namespace from "./shared";
export function storeThroughNamespace(): void { [...namespace.shared.rest] = [2, 3]; }
