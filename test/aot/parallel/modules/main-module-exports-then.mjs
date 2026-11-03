export function then(resolve) {
  console.log("then was called");
  resolve({});
}
setTimeout(() => console.log("a timer ran"), 1);
