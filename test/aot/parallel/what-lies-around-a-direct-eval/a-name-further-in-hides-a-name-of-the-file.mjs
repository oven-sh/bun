// The names of a file are listed once for all its direct evals, hidden or not. A name further in is found first, in reads and in stores.
let plain = "file";
const fixed = "file";
function declared() {
  return "file";
}
class Made {
  static where = "file";
}

function byParameter(plain, text) {
  return eval(text);
}
function byLocal(text) {
  let plain = "local";
  const answer = eval(text);
  return [answer, plain];
}
function byBlock(text) {
  {
    const fixed = "block";
    return eval(text);
  }
}
function byCatch(text) {
  try {
    throw "caught";
  } catch (plain) {
    return eval(text);
  }
}
function byFunction(text) {
  function declared() {
    return "inner";
  }
  return eval(text);
}
function byClass(text) {
  class Made {
    static where = "inner";
  }
  return eval(text);
}
const byOwnName = function plain(text) {
  return eval(text);
};
const byArrow = plain => text => eval(text);

console.log(byParameter("parameter", "(plain)"), byParameter("parameter", "plain"));
console.log(byParameter("parameter", "plain = 'stored'; plain"), plain);
console.log(byLocal("plain = 'stored'; plain"), plain);
console.log(byBlock("(fixed)"), byBlock("fixed"), fixed);
console.log(byCatch("(plain)"), byCatch("plain = 'stored'; plain"), plain);
console.log(byFunction("declared()"), declared());
console.log(byClass("Made.where"), Made.where);
console.log(typeof byOwnName("(plain)"), typeof byOwnName("plain"));
console.log(byArrow("arrow")("(plain)"), byArrow("arrow")("plain = 'stored'; plain"), plain);
console.log(byBlock("plain = 'from a block'; plain"), plain);
