export let calls = 0;
export function then(resolve) {
  calls++;
  resolve("resolved by the then export, call " + calls);
}
