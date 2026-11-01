// `["a", , "c"][1]` is printed `void 0`. A hole has no text of its own to quote, and what stands behind one in the file is quoted as ever.
const ofHole = ["a", , "c"][1];
console.log(ofHole);
const says = f => {
  try {
    f();
  } catch (error) {
    console.log(error.message);
  }
};
says(() => ofHole.x);
says(() => ofHole[0]);
says(() => new ofHole());
says(() => ({ ofHole }).ofHole.x);
const sixteen = 0x10;
says(() => null[sixteen]);
says(() => null[0x10]);
console.log(ofHole, [ofHole], { ofHole }, [, 1][0], [1, ,][1]);
