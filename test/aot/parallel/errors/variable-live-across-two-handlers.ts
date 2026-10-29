// A variable is read behind two try blocks that each caught something.
function make() {
  return { tag: "kept" };
}
let calls = 0;
function between() {
  calls++;
}
function adjacent() {
  const x = make();
  try {
    throw 1;
  } catch (a) {}
  try {
    throw 2;
  } catch (b) {}
  return x.tag;
}
function separated() {
  const x = make();
  try {
    throw 1;
  } catch (a) {}
  between();
  try {
    throw 2;
  } catch (b) {}
  return x.tag;
}
function stackIdiom() {
  const x = make();
  let stack;
  try {
    throw new Error("here");
  } catch (e) {
    stack = (e as Error).stack;
  }
  between();
  try {
    JSON.parse("{");
  } catch (b) {
    return x.tag + typeof stack;
  }
  return "no";
}
console.log(adjacent(), separated(), stackIdiom(), calls);
