declare const live: boolean;
if (live) {
  const numbers = async function* () { yield 1; };
  numbers();
}
export const answer = 1;
