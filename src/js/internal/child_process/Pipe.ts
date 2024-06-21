const { BunFile } = require("bun");
const fs = require("node:fs");

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

  constructor(type: SocketType) {
    this.#type = type;
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
    console.log("-- Pipe#readStart", [...arguments]);
  }

  writeUtf8String(req, string, handle) {
    console.log("-- Pipe#writeUtf8String", [...arguments]);
    try {
      fs.writeFileSync(this.#fd, string);
      return 0;
    } catch (e) {
      return e;
    }
  }

  writeBuffer() {
    console.log("-- Pipe#writeBuffer", [...arguments]);
  }

  close() {
    console.log("-- Pipe#close", [...arguments]);
    fs.closeSync(this.#fd);
    this.#fd = -1;
  }
}
