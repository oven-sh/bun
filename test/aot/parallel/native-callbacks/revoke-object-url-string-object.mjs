// URL.revokeObjectURL converts a String object by calling its own toString.
let calls = 0;
const url = new String("blob:x");
url.toString = () => {
  calls++;
  return "blob:y";
};
URL.revokeObjectURL(url);
console.log(calls);
