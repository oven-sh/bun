import * as all from "./far.mjs";
export const look = () => [all.round, all[JSON.parse('"round"')], Reflect.get(all, "round"), "round" in all, Object.keys(all).join("+")].map(String).join("/");
