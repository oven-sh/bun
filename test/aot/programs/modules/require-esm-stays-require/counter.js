export let count = 0;
export function increment() {
  count++;
}
export function read() {
  return count;
}
export function replaced() {
  return "original";
}
export function replace() {
  replaced = () => "replacement";
}
