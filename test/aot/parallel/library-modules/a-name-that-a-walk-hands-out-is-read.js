// The read under a name that nobody knows is what lets `process` go, not the walk.
for (const name in process) {
  if (name === "stdout") process[name].write("read under the name that the walk handed out\n");
}
