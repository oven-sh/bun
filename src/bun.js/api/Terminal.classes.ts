import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "Terminal",
    construct: true,
    constructNeedsThis: true,
    finalize: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    // Store callback references - prevents them from being GC'd while terminal is alive
    values: ["data", "drain", "exit"],
    proto: {
      write: {
        fn: "write",
        length: 1,
      },
      resize: {
        fn: "resize",
        length: 2,
      },
      setRawMode: {
        fn: "setRawMode",
        length: 1,
      },
      ref: {
        fn: "doRef",
        length: 0,
      },
      unref: {
        fn: "doUnref",
        length: 0,
      },
      close: {
        fn: "close",
        length: 0,
      },
      "@@asyncDispose": {
        fn: "asyncDispose",
        length: 0,
      },
      closed: {
        getter: "getClosed",
      },
      inputFlags: {
        getter: "getInputFlags",
        setter: "setInputFlags",
      },
      outputFlags: {
        getter: "getOutputFlags",
        setter: "setOutputFlags",
      },
      localFlags: {
        getter: "getLocalFlags",
        setter: "setLocalFlags",
      },
      controlFlags: {
        getter: "getControlFlags",
        setter: "setControlFlags",
      },

      // ----- Virtual Terminal (ghostty-vt) API -----
      // These methods provide terminal emulation: parsing escape sequences,
      // maintaining screen state (cells, cursor, colors), and rendering.

      // Feed data to the virtual terminal parser
      // This processes escape sequences and updates the screen state
      feed: {
        fn: "feed",
        length: 1,
      },

      // Get a specific cell from the screen buffer at (x, y)
      // Returns { char, wide, styled } or null if out of bounds
      at: {
        fn: "at",
        length: 2,
      },

      // Get a line of text relative to the bottom of the screen
      // line(0) = bottom line, line(1) = one above bottom, etc.
      line: {
        fn: "line",
        length: 1,
      },

      // Get the full screen content as text (getter)
      text: {
        getter: "getText",
      },

      // Get cursor position { x, y, visible, style }
      cursor: {
        getter: "getCursor",
      },

      // Get current screen dimensions
      cols: {
        getter: "getCols",
      },
      rows: {
        getter: "getRows",
      },

      // Get terminal title (set via OSC sequences)
      title: {
        getter: "getTitle",
      },

      // Check if terminal is in alternate screen mode
      alternateScreen: {
        getter: "getAlternateScreen",
      },

      // Get scrollback buffer size
      scrollbackLines: {
        getter: "getScrollbackLines",
      },

      // Clear the screen
      clear: {
        fn: "clearScreen",
        length: 0,
      },

      // Reset terminal to initial state
      reset: {
        fn: "resetTerminal",
        length: 0,
      },
    },
  }),
];
