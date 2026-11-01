// Bun.dns.lookup converts a String object that is the name by calling its own toString.
let calls = 0;
const name = new String("localhost");
name.toString = () => {
  calls++;
  return "localhost";
};
const addresses = await Bun.dns.lookup(name);
console.log(addresses.length > 0, calls);
