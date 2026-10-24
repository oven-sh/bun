// A namespace is exported under two names.
import { inner, again } from "./outer.mjs";
import * as direct from "./inner.mjs";
import * as outer from "./outer.mjs";
console.log(inner === direct, again === direct, outer.inner.v, Object.keys(outer).join(), inner[Symbol.toStringTag], Object.keys(inner).join());
direct.bump(); console.log(inner.v, outer.again.v);
