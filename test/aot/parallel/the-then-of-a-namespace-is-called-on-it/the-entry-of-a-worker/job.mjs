export const box = { n: 1 };
export function then(resolve) {
  postMessage("then " + (this.box === box));
  resolve();
}
