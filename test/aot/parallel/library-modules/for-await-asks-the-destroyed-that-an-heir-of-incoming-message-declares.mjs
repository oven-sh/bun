// `for await` over a stream asks `stream.destroyed` in front of every read. What was compiled ahead of time reads the state instead where the accessor that would answer is Readable's own.
// An heir that declares `destroyed` itself is asked, as plain asks it: here one that says yes while its state says no, so no chunk is read; and one two classes below that says no.
import http from "node:http";
import net from "node:net";

class SaysDestroyed extends http.IncomingMessage {
  get destroyed() {
    return true;
  }
  set destroyed(value) {
    super.destroyed = value;
  }
}
class Below extends SaysDestroyed {}
class SaysAlive extends Below {
  get destroyed() {
    return false;
  }
  set destroyed(value) {
    super.destroyed = value;
  }
}

const log = [];
for (const Class of [http.IncomingMessage, SaysDestroyed, Below, SaysAlive]) {
  const message = new Class(new net.Socket());
  message.push("a");
  const place = log.push(Class.name + " nothing") - 1;
  message[Symbol.asyncIterator]()
    .next()
    .then(
      step => (log[place] = Class.name + " " + String(step.value) + " " + step.done),
      error => (log[place] = Class.name + " error " + error.code),
    );
}
setTimeout(() => {
  console.log(log.join("\n"));
  process.exit(0);
}, 40);
