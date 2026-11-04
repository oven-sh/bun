// Bun.randomUUIDv5 converts a String object that is the encoding by calling its own toString.
let calls = 0;
const encoding = new String("base64");
encoding.toString = () => {
  calls++;
  return "hex";
};
console.log(Bun.randomUUIDv5("a", "6ba7b810-9dad-11d1-80b4-00c04fd430c8", encoding), calls);
