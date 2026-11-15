class Probe { static [Symbol.hasInstance](value) { return "mark" in value._stdout; } }
process.stdout.write(String(console instanceof Probe) + "\n");
