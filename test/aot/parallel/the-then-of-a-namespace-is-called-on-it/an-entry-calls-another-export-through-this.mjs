export let count = 1;
export function turn() {
  count = "text";
}
export function then(resolve) {
  this.turn();
  console.log(typeof count);
  resolve();
}
