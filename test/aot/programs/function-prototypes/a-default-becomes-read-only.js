"use strict";
// A read-only property above refuses the store: a strict store throws.
const log = [];
function Message(url) {
  this.id = 1;
  this.url = url;
}
Message.prototype.url = "";
function make(n) {
  let last;
  for (let i = 0; i < n; i++) last = new Message("/" + i);
  return last;
}
log.push(make(50).url);
Object.defineProperty(Message.prototype, "url", { writable: false });
try { log.push(make(1).url); } catch (e) { log.push(e.constructor.name); }
Object.defineProperty(Message.prototype, "url", { writable: true });
log.push(make(3).url);
Object.freeze(Message.prototype);
try { log.push(make(1).url); } catch (e) { log.push(e.constructor.name); }
console.log(log.join(" | "));
