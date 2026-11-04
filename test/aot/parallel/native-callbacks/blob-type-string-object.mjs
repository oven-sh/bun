// The Blob constructor converts a String object given as `type` by calling its own toString.
let calls = 0;
const type = new String("text/plain");
type.toString = () => {
  calls++;
  return "text/html";
};
console.log(new Blob([], { type }).type, calls);
