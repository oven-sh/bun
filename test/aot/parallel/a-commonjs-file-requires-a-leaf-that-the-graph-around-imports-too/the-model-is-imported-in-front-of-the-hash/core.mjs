import { name as model } from "./model.mjs";
import hash from "./hash.cjs";
import { name as view } from "./view.mjs";
export const name = "core(" + [model, view, hash.name].join() + ")";
