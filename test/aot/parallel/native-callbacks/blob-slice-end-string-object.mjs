// Blob.prototype.slice takes a String object in the place of `end` for the type, and converts it by calling its own toString.
let calls = 0;
const type = new String("text/html");
type.toString = () => {
  calls++;
  return "text/plain";
};
console.log(new Blob(["abc"]).slice(1, type).type, calls);
