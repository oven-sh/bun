// The options are filled under a key that only the run knows: the handler may be there, and it is.
const options = {};
options[JSON.parse('"terminal"')] = {
  data(terminal, bytes) {
    console.log(typeof terminal.write, new TextDecoder().decode(bytes).trim());
  },
};
Bun.spawn(["echo", "made up"], options);
