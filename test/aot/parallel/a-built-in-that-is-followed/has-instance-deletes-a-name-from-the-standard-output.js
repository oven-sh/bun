class Probe { static [Symbol.hasInstance](value) { return delete value.stdout.mark; } }
process.stdout.write(String(process instanceof Probe) + "\n");
