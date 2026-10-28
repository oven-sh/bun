import { nextTurns } from "../host.ts";
let sink: unknown;
class Message {
    id: number;
    declare retries: number;
    constructor(id: number) { this.id = id; }
}
Message.prototype.retries = 3;
function bench(n: number): number {
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
