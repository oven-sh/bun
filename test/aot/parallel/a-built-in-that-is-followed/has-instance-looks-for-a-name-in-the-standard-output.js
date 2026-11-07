class Probe { static [Symbol.hasInstance](value) { return "mark" in value.stdout; } }
process.stdout.write(String(process instanceof Probe) + "\n");
