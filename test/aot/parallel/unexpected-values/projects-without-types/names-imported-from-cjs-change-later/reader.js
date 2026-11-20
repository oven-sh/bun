import whole, { count, list, size } from "./state.cjs";
import * as space from "./state.cjs";

export const byName = () => [count + 1, list.length, size()];
export const throughTheDefault = () => [whole.count + 1, whole.list.length, whole.size()];
export const throughTheNamespace = () => [space.count + 1, space.list.length, space.size()];
export const added = () => [whole.added, space.added, "added" in whole, "added" in space];
export const same = () => [whole.list === list, space.list === list, space.default === whole];
