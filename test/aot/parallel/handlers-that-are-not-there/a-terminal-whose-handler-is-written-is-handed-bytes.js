// The handler is there: it is handed the terminal and the bytes that the child wrote, both made by native code, and uses them.
// The bytes come in one piece or in several: a terminal makes "\r\n" of the end of the line in a step of its own. What is printed does not hang on where they are cut.
let write;
let text = "";
Bun.spawn(["echo", "made up"], {
  terminal: {
    data(terminal, bytes) {
      write = typeof terminal.write;
      text += new TextDecoder().decode(bytes);
    },
  },
});
process.on("exit", () => console.log(write, text.trim()));
