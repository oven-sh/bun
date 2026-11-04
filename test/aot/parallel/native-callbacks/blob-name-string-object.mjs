// The setter of the name of a Blob converts a String object by calling its own toString.
let calls = 0;
const name = new String("a");
name.toString = () => {
  calls++;
  return "b";
};
const blob = new Blob(["abc"]);
blob.name = name;
console.log(blob.name, calls);
