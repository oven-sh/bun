export const shared = ["a", "b", "c"];
export const changedElsewhere = ["a", "b", "c"];
export const changedHere = ["a", "b", "c"];
export function change() {
  changedHere.push("z");
}
export function look(list, word) {
  return `${list.includes(word)} ${list.indexOf(word)} ${list.join("+")}`;
}
export function lookAtShared(word) {
  return `${shared.includes(word)} ${shared.indexOf(word)} ${shared.join("+")} ${[...shared, word].length} ${new Set(shared).size}`;
}
