// The options are filled under a key that only the run knows: the handler may be there, and it is.
// The bytes come in one piece or in several: what is printed does not hang on where they are cut.
let write;
let text = "";
const options = {};
options[JSON.parse('"terminal"')] = {
  data(terminal, bytes) {
    write = typeof terminal.write;
    text += new TextDecoder().decode(bytes);
  },
};
Bun.spawn(["echo", "made up"], options);
process.on("exit", () => console.log(write, text.trim()));
