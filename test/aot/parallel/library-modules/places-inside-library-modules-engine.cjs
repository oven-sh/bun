// Each line: the frames of an error that a library module throws where the engine records no place of its own: a pattern over a missing argument.
function show(label, error) {
  const frames = String(error.stack).split("\n").slice(1, 4);
  const places = frames.map(line => line.trim().replace(/\(?[^ (]*[\\/]([^\\/ ]+:\d+:\d+)\)?/, "$1"));
  console.log(label, "|", error.name, "|", error.message, "|", places.join(" < "));
}
try {
  require("node:tls").checkServerIdentity(1n);
} catch (error) {
  show("tls", error);
}
