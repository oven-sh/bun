interface Only {
  a: number;
}
// @ts-ignore
export default Only as unknown;
console.log("asserted");
