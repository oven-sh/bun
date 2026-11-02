// Sloppy code. The emitter of the library, and a constructor function that runs it on its own object, are kept in global variables that nobody declares.
EventEmitter = require("node:events");
function Stream() {
  EventEmitter.call(this);
}
stream = Stream;
