export let count = JSON.parse("1");
export const label = JSON.parse('"other"');
let own = JSON.parse('"other"');
let hidden = JSON.parse("5");
export function bump() {
  count += 1;
  return count;
}
export default function lookInOther(text) {
  return eval(text);
}
export function alsoLookInOther(text) {
  return [eval(text), own, hidden];
}
