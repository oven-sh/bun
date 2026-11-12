const list = holder => Object.entries(holder).map(([name, value]) => name + ":" + typeof value).join();
export const box = { n: 1 };
export let count = 3;
export function then(resolve) {
  console.log(list(this));
  resolve();
}
