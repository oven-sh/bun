// A loop runs its body often, also in a function that is itself called once, as the `main` of a program is: what the loop calls is no rare code.
function countsMissing(...args: unknown[]): number {
  let missing = 0;
  for (let k = args.length + 1; k >= -1; k--) if (args[k] === undefined) missing++;
  return missing;
}
const callees = [countsMissing];
function main(turns: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (sum + callees[0]!(i, 1, 2)) | 0;
  return sum;
}
console.log(main(400_000));
