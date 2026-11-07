// The host awaits the namespace of the entry, so it calls `then` on it: that function reads every export through `this`.
export const box = { n: 1 };
export function then(resolve) {
  console.log("then", this.box === box);
  resolve();
}
