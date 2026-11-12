// Methods taken off their objects and put on others
const speaker = {
  name: "speaker",
  who() {
    return this === undefined ? "nobody" : this.name;
  },
};
function borrow(name) {
  const other = { name, who: speaker.who };
  const list = [speaker.who, other.who.bind(speaker), () => other.who()];
  const named = { name: "list", call: list[1], direct: list[0], later: list[2] };
  return [other.who(), named.call(), named.direct(), named.later(), list.map(f => f.call({ name: "x" })).join("+")].join();
}
console.log(borrow("a"));
console.log(borrow("bb"));
console.log(borrow(""));
