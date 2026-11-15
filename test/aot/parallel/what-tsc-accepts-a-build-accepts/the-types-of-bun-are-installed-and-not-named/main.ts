export {};
function report(): void {
  console.log("ran");
}
const id: number = setTimeout(report, 1);
console.log(typeof id);
