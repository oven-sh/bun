// The list of texts that a tagged template hands to its tag is frozen: a native walks it by the protocol.
function distinct(texts) {
  return new Set(texts).size;
}
console.log(distinct`x${1}y${2}x`);
