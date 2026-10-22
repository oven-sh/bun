function Listener(name) {
  this.name = name;
  this.handler = function () { return name + " handled"; };
  this.next = null;
}
function fire(listener) {
  const handler = listener.handler;
  return handler === null ? "none" : typeof handler === "function" ? handler() : "a " + typeof handler;
}
const first = new Listener("first"), second = new Listener("second"), third = new Listener("third");
first.next = second;
console.log(fire(first), fire(second), fire(third));
second.handler = null;
third.handler = 3;
console.log(fire(first), fire(second), fire(third));
third.handler = first.handler;
console.log(fire(third), first.next.name, second.next);
