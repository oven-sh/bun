class Probe { static [Symbol.hasInstance](value) { return Reflect.ownKeys(value.stdout).length > 0; } }
process.stdout.write(String(process instanceof Probe) + "\n");
