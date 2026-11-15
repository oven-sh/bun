class Probe { static [Symbol.hasInstance](value) { value.stdout.mark = 1; return true; } }
process.stdout.write(String(process instanceof Probe) + "\n");
