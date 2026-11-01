function Message(url) { this.url = url; }
const log = [];
const between = { set url(v) { log.push("setter " + v); } };
Message.prototype.url = 0;
Object.setPrototypeOf(Message.prototype, between);
function make(v) { return new Message(v); }
for (let i = 0; i < 40; i++) make(i);
delete Message.prototype.url;
const m = make(77);
console.log(log.join(), "|", Object.keys(m).join());
