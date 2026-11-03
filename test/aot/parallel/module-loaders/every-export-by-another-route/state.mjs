export let state = "initial";
export function read() {
  return state;
}
export function set(next) {
  state = next;
}
export function unused() {
  return "unused by any import";
}
