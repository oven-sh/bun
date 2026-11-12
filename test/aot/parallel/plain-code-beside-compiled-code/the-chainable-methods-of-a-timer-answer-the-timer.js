const said = [];
function ask(name, timer, methods) {
  for (const method of methods) said.push(name + "." + method + ":" + (timer[method]() === timer));
}
const later = setTimeout(() => {}, 1 << 30);
ask("a timeout", later, ["unref", "ref", "refresh", "unref", "close", "ref", "unref", "refresh", "close"]);
const again = setInterval(() => {}, 1 << 30);
ask("an interval", again, ["unref", "ref", "refresh", "close"]);
const soon = setImmediate(() => {});
ask("an immediate", soon, ["unref", "ref", "unref"]);
clearImmediate(soon);
const fired = setTimeout(() => {
  ask("a timeout that has fired", fired, ["unref", "ref", "refresh", "close"]);
  const borrowed = later.ref;
  said.push("on what is no timer:" + String(borrowed.call({})));
  console.log(said.join("\n"));
}, 1);
/* Output:
a timeout.unref:true
a timeout.ref:true
a timeout.refresh:true
a timeout.unref:true
a timeout.close:true
a timeout.ref:true
a timeout.unref:true
a timeout.refresh:true
a timeout.close:true
an interval.unref:true
an interval.ref:true
an interval.refresh:true
an interval.close:true
an immediate.unref:true
an immediate.ref:true
an immediate.unref:true
a timeout that has fired.unref:true
a timeout that has fired.ref:true
a timeout that has fired.refresh:true
a timeout that has fired.close:true
on what is no timer:undefined
*/
