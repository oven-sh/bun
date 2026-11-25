// A control: the methods are asked about and called on their targets: the global object goes nowhere.
// STATISTIC: FunctionsLowered <= 1000
function listen(target, listener) {
  if (typeof target.addEventListener === "function") target.addEventListener("ping", listener);
  return target.dispatchEvent ? target.dispatchEvent(new Event("ping")) : false;
}
const own = new EventTarget();
console.log(listen(own, event => console.log(event.target === own)));
