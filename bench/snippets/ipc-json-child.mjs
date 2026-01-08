// Child process for IPC benchmarks - echoes messages back to parent
process.on("message", message => {
  process.send(message);
});
