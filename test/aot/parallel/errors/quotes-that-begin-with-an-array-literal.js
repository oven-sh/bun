// An error quotes what failed as `bun run` prints it. What is read from or called may begin with an array literal, and an index into one is printed as the element, a hole as `void 0`.
const ofHole = ["a", , "c"][1];
const ofNull = [null, 1][0];
let nothing;
const says = f => {
  try {
    f();
    console.log("nothing thrown");
  } catch (error) {
    console.log(error.message);
  }
};
says(() => ofHole.x);
says(() => ofNull.x);
says(() => ["a", , "c"][1].x);
says(() => ["a", , "c"][1]());
says(() => [, 1][0].x);
says(() => [1, ,][1].x);
says(() => [null, 1][0].x);
says(() => [undefined][0].x);
says(() => [nothing][0].x);
says(() => [nothing][0]());
says(() => [nothing, 1][0].x);
says(() => [1, nothing][1].x.y);
says(() => ["a", , "c"][1][0]);
says(() => ["a", , "c"][1].x.y);
says(() => [1, 2][5].x);
says(() => [nothing].at(0).x);
says(() => { return ["a", , "c"][1].x; });
says(() => { const list = [1]; [nothing][0].x; });
