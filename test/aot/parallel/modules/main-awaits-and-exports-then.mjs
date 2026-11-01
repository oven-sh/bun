export function then(resolve) {
  console.log("then is called");
  resolve();
}
await 0;
console.log("ran");
