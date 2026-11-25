export class Made extends Worker {
  constructor(isFirst) {
    if (isFirst) super("./worker.mjs");
    else super(new URL("./worker.mjs", import.meta.url));
  }
}
