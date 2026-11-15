const box = { n: 1 };
export { box };
export function then(resolve) {
  this.box.more = 2;
  console.log(Object.keys(box).join(), box.more);
  resolve();
}
