// calls a function of a host object, outside loops
const operations = 4;
let total = 0;

kernel: {
  total += process.uptime() > 0 ? 1 : 0;
  total += process.uptime() > 0 ? 1 : 0;
  total += process.uptime() > 0 ? 1 : 0;
  total += process.uptime() > 0 ? 1 : 0;
}

console.log(total);
