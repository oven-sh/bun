import { value, change } from "./once.cjs";
import * as namespace from "./once.cjs";
change();
export const seen = [value, namespace.value, "added" in namespace, namespace.default.value];
