// prettier-ignore
({ [("a")]: module });
function typeOfThis() {
  return typeof this;
}
console.log('[("a")]', typeOfThis());
