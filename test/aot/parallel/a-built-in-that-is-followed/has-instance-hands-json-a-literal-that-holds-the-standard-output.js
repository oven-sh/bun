class Probe {
  static [Symbol.hasInstance](value) {
    try {
      JSON.stringify({ held: value.stdout });
    } catch {}
    return true;
  }
}
process.stdout.write(String(process instanceof Probe) + "\n");
