export const readAList = key => ["a", "b", "c"][key];
export const readAText = key => "abc"[key];
export const readATable = key => ({ 0: "zero", 1: "one", a: "letter" })[key];
export const readBytes = key => new Uint8Array([7, 8, 9])[key];
export function storeIntoAList(key) {
  const list = ["a", "b", "c"];
  list[key] = "stored";
  return [list.length, Object.keys(list).join()];
}
export function storeIntoATable(key) {
  const table = { 1: "one" };
  table[key] = "stored";
  return Reflect.ownKeys(table).map(String).join();
}
export function storeIntoBytes(key) {
  const bytes = new Uint8Array(3);
  bytes[key] = 5;
  return [Array.from(bytes).join(), Object.keys(bytes).length];
}
export const askAList = key => key in ["a", "b", "c"];
export const askATable = key => Object.hasOwn({ 1: "one" }, key);
export function removeFromAList(key) {
  const list = ["a", "b", "c"];
  return [delete list[key], 1 in list];
}
export const inALiteral = key => Object.keys({ [key]: 1 }).join();
export const callByKey = key => typeof ["a"][key];
