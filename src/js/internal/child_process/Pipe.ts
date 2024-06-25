const { BunFile } = require("bun");
const fs = require("node:fs");
let isPrimary;

type SocketType = keyof typeof Pipe.constants;

export default class Pipe {
  static constants = Object.freeze({
    SOCKET: "SOCKET",
    SERVER: "SERVER",
    IPC: "IPC",
  });

  #type: SocketType;
  #fd: number;
  #ref_count = 1;
  #target;

  constructor(type: SocketType, fd, target) {
    this.#type = type;
    isPrimary ??= require("node:cluster").isPrimary;
    this.#fd = fd;
    this.#target = target;
  }

  open(fd: number) {
    this.#fd = fd;
  }

  ref() {
    this.#ref_count += 1;
  }

  unref() {
    this.#ref_count -= 1;
  }

  get fd() {
    return this.#fd;
  }

  readStart() {
  }

  writeUtf8String(req, string, handle) {
    try {
      fs.writeFileSync(this.#fd, string);
      return 0;
    } catch (e) {
      return e;
    }
  }

  writeBuffer() {
  }

  close() {
    if (!isPrimary) fs.closeSync(this.#fd);
    this.#fd = -1;
  }
}
