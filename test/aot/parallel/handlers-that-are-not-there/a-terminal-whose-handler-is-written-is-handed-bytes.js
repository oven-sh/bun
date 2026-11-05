// The handler is there: it is handed the terminal and the bytes that the child wrote, both made by native code, and uses them.
Bun.spawn(["echo", "made up"], {
  terminal: {
    data(terminal, bytes) {
      console.log(typeof terminal.write, new TextDecoder().decode(bytes).trim());
    },
  },
});
