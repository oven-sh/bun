class Probe { static [Symbol.hasInstance](holder) { return "mark" in holder.stdout; } }
process.stdout.write(String(process instanceof Probe) + "\n");
if (process.argv.length > 5) process.stdout = null;
