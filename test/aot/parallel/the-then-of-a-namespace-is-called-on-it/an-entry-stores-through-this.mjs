const box = { kind: "first" };
export { box };
export function then(resolve) {
  this.box.kind = "second";
  console.log(box.kind === "first" ? "still the first" : "changed");
  resolve();
}
