// Functions of node:http that count under a key of their receiver, or apply what one argument names to what another lists: on undefined and null, and with neither a function nor a list.
const http = require("node:http");
function show(label, run) {
  try {
    console.log(label, "returned", String(run()));
  } catch (error) {
    console.log(label, error.name + ": " + error.message.split(" (")[0].replace(/^.* is not a function\.?$/, "what is called is not a function"));
  }
}
for (const receiver of [undefined, null]) {
  show("cork " + receiver, () => http.OutgoingMessage.prototype.cork.call(receiver));
  show("uncork " + receiver, () => http.OutgoingMessage.prototype.uncork.call(receiver));
}
const response = new http.ServerResponse(new http.IncomingMessage(null));
const copy = () => Object.assign(Object.create(http.ServerResponse.prototype), response);
for (const [name, list] of [
  ["number", 1],
  ["text", "ab"],
  ["true", true],
  ["symbol", Symbol("s")],
  ["undefined", undefined],
  ["null", null],
  ["list", [1]],
  ["object", {}],
]) {
  show("nothing, " + name, () => http.ClientRequest.prototype._deferToConnect.call(copy(), "a", list));
  show("a number, " + name, () => {
    const request = copy();
    request.socket = { a: 5, writable: true };
    return http.ClientRequest.prototype._deferToConnect.call(request, "a", list);
  });
  show("a function, " + name, () => {
    const request = copy();
    let passed;
    request.socket = {
      a() {
        passed = arguments.length;
      },
      writable: true,
    };
    http.ClientRequest.prototype._deferToConnect.call(request, "a", list);
    return passed;
  });
}
