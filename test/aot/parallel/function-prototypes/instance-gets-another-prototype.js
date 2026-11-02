// new.target with another prototype, Reflect.construct, and an instance whose prototype is changed inside the constructor.
const log = [];
function Message(url, swap) {
  this.id = 1;
  if (swap) Object.setPrototypeOf(this, swap);
  this.url = url;
}
Message.prototype.url = "";
const other = { set url(v) { log.push("other set " + v); }, get url() { return "other get"; } };
let m;
for (let i = 0; i < 40; i++) m = new Message("/" + i);
log.push(Object.keys(m).join(), m.url);
m = new Message("/swapped", other);
log.push(Object.keys(m).join(), m.url);
function Target() {}
Target.prototype = other;
m = Reflect.construct(Message, ["/constructed"], Target);
log.push(Object.keys(m).join(), m.url);
m = new Message("/plain");
log.push(Object.keys(m).join(), m.url);
const proxied = new Proxy({}, { set(t, k, v, r) { log.push("proxy set " + String(k)); return Reflect.set(t, k, v, r); } });
m = new Message("/proxy", proxied);
log.push(Object.keys(m).join(), m.url);
console.log(log.join(" | "));
