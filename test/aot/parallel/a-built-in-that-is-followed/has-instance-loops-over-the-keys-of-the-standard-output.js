class Probe { static [Symbol.hasInstance](value) { for (const key in value.stdout) return true; return false; } }
process.stdout.write(String(process instanceof Probe) + "\n");
