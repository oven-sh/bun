class Probe {
  static [Symbol.hasInstance](value) {
    const write = value.stdout.write;
    write.call({ _write(data) { console.log("wrote " + data); } }, "text");
    return true;
  }
}
console.log(process instanceof Probe);
