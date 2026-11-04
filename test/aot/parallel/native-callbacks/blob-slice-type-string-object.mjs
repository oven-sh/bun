// Blob.prototype.slice converts a String object given as the content type by calling its own toString.
let calls = 0;
const type = new String("text/plain");
type.toString = () => {
  calls++;
  return "text/html";
};
console.log(new Blob(["ab"]).slice(0, 1, type).type, calls);
