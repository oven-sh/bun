export function then(resolve) {
  console.log("then", typeof this.box, Object.keys(this).join());
  resolve();
}
