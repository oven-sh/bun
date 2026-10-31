// One place hands Object.create() Object.prototype. The literal that it could be handed, and the function that the literal could get, never come in this run: the object has no such method.
const members = {};
function make(proto) {
  const made = Object.create(proto); // not a tail call
  made.items = 7;
  return made;
}
function call(made) { try { return made.later(); } catch (e) { return e.constructor.name; } }
function run(made) { return made.later?.() ?? "no method"; }
function main(label) {
  const first = make(Object.prototype);
  console.log("first: ", call(first), run(first));
  if (process.argv.length > 5) {
    const secret = { text: label + process.argv.length };
    members.later = function () { return "later " + secret.text.length + " " + this.items; };
    console.log("second:", call(make(members)));
  }
  console.log("first: ", call(first), run(first));
}
main("secret");
