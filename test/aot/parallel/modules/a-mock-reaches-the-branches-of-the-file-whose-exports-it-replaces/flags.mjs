export function first() {
  return "first";
}
export const enabled = false;
export const level = 1;
export const label = "plain";
export const nothing = null;
export const table = { size: 1 };
export let storedOnce = 1;
export var declaredWithVar = 1;
const renamedInside = 1;
export { renamedInside as renamed };
const copied = 1;
export default copied;
const kept = 1;
const madeFromLevel = level + 1;

export const conditional = () => (enabled ? "on" : "off");
export const earlyReturn = () => {
  if (level === 1) return "one";
  return "other:" + level;
};
export const and = () => enabled && level;
export const or = () => enabled || "fallback";
export const nullish = () => nothing ?? "nothing";
export const not = () => !enabled;
export const kind = () => typeof level;
export const text = () => `${label}:${label.length}`;
export const object = () => (table ? "table" : "no table");
export const chain = () => table?.size;
export const once = () => (storedOnce === 1 ? "one" : "other:" + storedOnce);
export const hoisted = () => (declaredWithVar === 1 ? "one" : "other:" + declaredWithVar);
export const underAnotherName = () => (renamedInside === 1 ? "one" : "other:" + renamedInside);
export const copy = () => (copied === 1 ? "one" : "other:" + copied);
export const notExported = () => (kept === 1 ? "one" : "other:" + kept);
export const computedOnce = () => (madeFromLevel === 2 ? "two" : "other:" + madeFromLevel);
export const chosen = () => {
  switch (level) {
    case 1:
      return "case one";
    case 2:
      return "case two";
  }
  return "no case";
};
export const turns = () => {
  let count = 0;
  while (enabled && count < 3) count++;
  return count;
};
export const loaded = () => (enabled ? require("./behind-a-branch.cjs").name : "not loaded");
export function declared() {
  if (!enabled) return "off";
  return "on";
}
export class Reader {
  read() {
    return enabled ? "on" : "off";
  }
}
