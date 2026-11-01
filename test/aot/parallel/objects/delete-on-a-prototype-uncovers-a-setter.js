function Message(url) { this.url = url; }
const log = [];
const between = { set url(v) { log.push("setter " + v); } };
Message.prototype.url = "";
Object.setPrototypeOf(Message.prototype, between);
new Message("b");
delete Message.prototype.url;
const m = new Message("c");
console.log(log.join(), "|", Object.keys(m).join());
