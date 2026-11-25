// Build prints: 1 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
class Made extends Worker {
  constructor(file) {
    if (file) super(file);
    else super(new URL("./worker.mjs", import.meta.url));
  }
}
const made = new Made(process.argv[5]);
made.onmessage = event => {
  console.log(event.data);
  made.terminate();
};
