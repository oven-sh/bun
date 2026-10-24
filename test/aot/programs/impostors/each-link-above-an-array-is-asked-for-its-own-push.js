let link = [1];
const found = [];
while (link) {
  found.push(link.hasOwnProperty("push"));
  link = Object.getPrototypeOf(link);
}
console.log(found.join());
