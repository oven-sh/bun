function say(out, text) { return out.write(text) && out.writable; }
console.log(say(process.stdout, "handed on\n"), say(process.stderr, "handed on\n"));
