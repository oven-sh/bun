// Ported from Node.js v26.3.0 lib/internal/readline/emitKeypressEvents.js for Bun's node:repl.
// Attribution: derived from Node.js, MIT licensed (Node.js contributors).
// prettier-ignore
const primordials = require("internal/repl/node-primordials");
var __node_module__ = { exports: {} };

const { Symbol } = primordials;

const { charLengthAt, emitKeys } = require("internal/readline/utils");
const { kSawKeyPress } = require("internal/readline/interface");

const { clearTimeout, setTimeout } = require("node:timers");

const { StringDecoder } = require("node:string_decoder");

const StringPrototypeCharCodeAtFn = String.prototype.charCodeAt;
const StringPrototypeSliceFn = String.prototype.slice;

const KEYPRESS_DECODER = Symbol("keypress-decoder");
const ESCAPE_DECODER = Symbol("escape-decoder");

// GNU readline library - keyseq-timeout is 500ms (default)
const ESCAPE_CODE_TIMEOUT = 500;

/**
 * accepts a readable Stream instance and makes it emit "keypress" events
 */

function emitKeypressEvents(stream, iface = {}) {
  if (stream[KEYPRESS_DECODER]) return;

  stream[KEYPRESS_DECODER] = new StringDecoder("utf8");

  let next = (stream[ESCAPE_DECODER] = emitKeys(stream));

  const triggerEscape = () => {
    try {
      next("", -1);
    } catch (err) {
      // Nobody starts the decoder again here.
      next = stream[ESCAPE_DECODER] = () => {};
      throw err;
    }
  };
  const { escapeCodeTimeout = ESCAPE_CODE_TIMEOUT } = iface;
  let timeoutId;

  function onData(input) {
    if (stream.listenerCount("keypress") > 0) {
      const string = stream[KEYPRESS_DECODER].write(input);
      if (string) {
        clearTimeout(timeoutId);

        // This supports characters of length 2.
        iface[kSawKeyPress] = charLengthAt(string, 0) === string.length;
        iface.isCompletionEnabled = false;

        const total = string.length;
        let length = 0;
        while (length < total) {
          const start = length++;
          let unit = StringPrototypeCharCodeAtFn.$call(string, start);
          if (unit >= 0xd800 && unit <= 0xdbff && length < total) {
            const trail = StringPrototypeCharCodeAtFn.$call(string, length);
            if (trail >= 0xdc00 && trail <= 0xdfff) {
              length++;
              unit = -1;
            }
          }
          const character = StringPrototypeSliceFn.$call(string, start, length);
          if (length === total) {
            iface.isCompletionEnabled = true;
          }

          try {
            next(character, unit);
            // Escape letter at the tail position
            if (length === total && unit === 27) {
              timeoutId = setTimeout(triggerEscape, escapeCodeTimeout);
            }
          } catch (err) {
            // If the decoder throws (it could happen in the `keypress`
            // event), we need to restart it.
            next = stream[ESCAPE_DECODER] = emitKeys(stream);
            throw err;
          }
        }
      }
    } else {
      // Nobody's watching anyway
      stream.removeListener("data", onData);
      stream.on("newListener", onNewListener);
    }
  }

  function onNewListener(event) {
    if (event === "keypress") {
      stream.on("data", onData);
      stream.removeListener("newListener", onNewListener);
    }
  }

  if (stream.listenerCount("keypress") > 0) {
    stream.on("data", onData);
  } else {
    stream.on("newListener", onNewListener);
  }
}

__node_module__.exports = emitKeypressEvents;

export default __node_module__.exports;
