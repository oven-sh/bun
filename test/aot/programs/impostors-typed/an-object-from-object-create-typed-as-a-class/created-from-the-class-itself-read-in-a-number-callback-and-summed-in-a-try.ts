class Safe {
  }
function attempt(run: () => number): number {
  try {
    return run()} catch (error) {
    return error ? 1 : 2}
}
let checksum = 0;
function note(value: number){
  checksum = Math.imul(checksum, 31) + value| 0}
const bare: Safe = Object.create(Safe);
note(attempt(() => (bare as any).code))
console.log("checksum", checksum);
