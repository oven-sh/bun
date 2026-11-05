import * as dep from "dep";
const show = it => it.value() + ":" + it.kind + ":" + String(it.added);
export const seen = () => show(dep);
