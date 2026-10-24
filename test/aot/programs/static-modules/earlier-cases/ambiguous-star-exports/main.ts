// Two stars that export one name, directly and through other modules.
// @ts-nocheck
declare const console: { log(...values: unknown[]): void };
import * as barrel from "./barrel.mjs";
import * as outer from "./outer.mjs";
import { shared, hidden, onlyRight, deep } from "./barrel.mjs";
const value = [barrel][0], outerValue = [outer][0];
console.log(Object.keys(value).join(), "|", Object.keys(outerValue).join());
console.log(String(barrel.both), String(value.both), "both" in value, String(barrel.onlyLeft), String(outer.both), String(outer.onlyLeft));
console.log(shared, hidden, onlyRight, deep, barrel.shared, barrel.hidden, outer.hidden);
