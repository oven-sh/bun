import { nextTurns } from "../host.ts";
let sink;
class Message {
    constructor(id) { this.id = id; }
}
Message.prototype.retries = 3;
function bench(n) {
    let s = 0;
    for (let i = 0; i < n; i++) {
        const message = new Message(i);
        if ((i & 1023) === 0) message.retries = 5;
        s += message.retries;
    }
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check, typeof sink);
