// `isTrusted` is an own property of every event. A function without types reads it off events of three classes.
function get(event) {
  return event.isTrusted;
}
console.log(get(new Event("x")) === undefined, typeof get(new Event("y")), get(new Event("z")) ?? "nullish");
console.log(
  get(new CustomEvent("x", { detail: 1 })) ?? "nullish",
  get(new MessageEvent("m", { data: 1 })) ?? "nullish",
);
console.log(Object.getOwnPropertyNames(new Event("x")).join(), Object.hasOwn(new Event("x"), "isTrusted"));
