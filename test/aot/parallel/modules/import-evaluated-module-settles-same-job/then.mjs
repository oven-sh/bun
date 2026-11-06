let calls = 0;
export function then(resolve) {
  resolve(`call ${++calls}`);
}
