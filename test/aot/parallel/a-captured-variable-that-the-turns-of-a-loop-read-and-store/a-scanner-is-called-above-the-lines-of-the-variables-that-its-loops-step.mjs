// Under: --aot-harden=proof-checks: the reads of the slots that are laid in front of the loops to be tested said that they follow their stores: as users build the answer was right, and there the proof was found false
(function whole() {
let seen = "none";
try {
  skipBlanks();
} catch (error) {
  seen = error.constructor.name;
}
console.log(seen);
let source = "";
let position = 0;
let line = 1;
function skipBlanks() {
  while (position < source.length) {
    const code = source.charCodeAt(position);
    if (code === 32 || code === 9) position++;
    else if (code === 10) {
      line++;
      position++;
    } else if (code === 35) {
      while (position < source.length && source.charCodeAt(position) !== 10) position++;
    } else break;
  }
}
source = "  \t# a comment\n \n# another\n  x".replace("x", String(JSON.parse("7")));
skipBlanks();
console.log(position + " " + line + " " + source.charCodeAt(position));
})();
