export const a = 1;
export const box = { n: 1 };
export function then(resolve) {
  console.log("then", this.box === box, Object.keys(this).join());
  resolve({ a: 2 });
}
