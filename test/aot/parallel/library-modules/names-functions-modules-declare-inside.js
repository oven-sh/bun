// Prints the names of functions that node:crypto, node:readline and node:stream declare inside a block: two classes, and listeners that the modules add.
const { Cipheriv, Decipheriv } = require("node:crypto");
const { createInterface } = require("node:readline");
const { PassThrough, pipeline } = require("node:stream");

const namesOf = listeners => listeners.map(listener => (listener.listener ?? listener).name);

console.log(Cipheriv.name, Cipheriv.length, Decipheriv.name, Decipheriv.length);
console.log(Cipheriv, Decipheriv);

const lines = createInterface({ input: new PassThrough(), terminal: false });
console.log("readline", namesOf(lines.rawListeners("close")));
lines.close();

const terminal = createInterface({ input: new PassThrough(), output: new PassThrough(), terminal: true });
console.log("readline in a terminal", namesOf(terminal.rawListeners("close")));
terminal.close();

const [first, second, third] = [new PassThrough(), new PassThrough(), new PassThrough()];
pipeline(first, second, third, error => console.log("pipeline ended", error?.name));
for (const stream of [first, second, third])
  console.log("pipeline", namesOf(stream.rawListeners("error")), namesOf(stream.rawListeners("end")));
third.resume();
first.end("done");

const counts = { Cipheriv: "as written", [Cipheriv.name]: "by name" };
console.log(counts[Cipheriv.name], Object.keys(counts).length, Object.getOwnPropertyDescriptor(Cipheriv, "name"));
console.log(Reflect.ownKeys(Cipheriv), new Cipheriv("aes-128-cbc", Buffer.alloc(16), Buffer.alloc(16)).constructor.name);
try {
  Cipheriv("no such cipher", Buffer.alloc(16), Buffer.alloc(16));
} catch (error) {
  const frames = error.stack.split("\n").slice(0, 3);
  console.log(frames.map(frame => frame.replace(/ \(.*\)$/, "")).join("\n"));
}
/* Output:
Cipheriv 4 Decipheriv 4
[LazyTransform: Cipheriv] [LazyTransform: Decipheriv]
readline [ "onSelfCloseWithoutTerminal" ]
readline in a terminal [ "onSelfCloseWithTerminal" ]
pipeline [ "onerror", "onError", "onerror" ] [ "onend", "unpipe", "endFn", "onend" ]
pipeline [ "onerror", "onerror", "onError", "onerror", "onerror" ] [ "onend", "onend", "unpipe",
  "endFn", "onend"
]
pipeline [ "onerror", "onerror", "onError", "onerror" ] [ "onend", "onend" ]
by name 1 {
  value: "Cipheriv",
  writable: false,
  enumerable: false,
  configurable: true,
}
[ "length", "name", "prototype" ] Cipheriv
Error: Unknown cipher
    at Cipher
    at new Cipheriv
pipeline ended undefined
*/
