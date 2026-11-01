// Bun.dns.prefetch converts a String object that is the name by calling its own toString.
let calls = 0;
const name = new String("localhost");
name.toString = () => {
  calls++;
  return "localhost";
};
Bun.dns.prefetch(name, 80);
console.log(calls);
