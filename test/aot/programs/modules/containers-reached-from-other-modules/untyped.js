// Untyped code that imports the store by itself.
import * as store from "./store";
export function reach(name) { return store[name]; }
