// The setter of the name of a Blob keeps the object that it is handed, and the getter hands it out again.
class Name extends String {
  n = 0;
}
function run() {
  const name = new Name("a");
  const blob = new Blob(["x"]);
  blob.name = name;
  blob.name.n = 5;
  return name.n;
}
console.log(run(), run());
