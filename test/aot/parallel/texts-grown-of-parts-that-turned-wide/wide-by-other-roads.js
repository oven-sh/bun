// other makers of 16-bit texts that hold 8-bit characters alone: a slice of a wide text, a Buffer decoded as utf16le, TextDecoder, String.fromCharCode beside a wide one
const count = 20000;
const textOf = (i) => "identifier-number-" + (100000 + i);
const written = []; for (let i = 0; i < count; i++) written.push(textOf(i));
const makers = {
  slice: () => { const all = "Ā" + written.join("Ā"); return all.split("Ā").slice(1); },
  utf16le: () => written.map((t) => Buffer.from(t, "utf16le").toString("utf16le")),
  decoder: () => { const d = new TextDecoder("utf-16le"); return written.map((t) => d.decode(Buffer.from(t, "utf16le"))); },
  substring: () => written.map((t) => (t + "Ā").substring(0, t.length)),
};
for (const [how, make] of Object.entries(makers)) {
  const seen = Object.create(null); for (const name of make()) seen[name + ""] = 0, seen[name] = 0;
  const narrow = []; for (let i = 0; i < count; i++) narrow.push(textOf(i));
  const state = JSON.parse('{"out":"names:"}');
  for (let i = 0; i < count; i++) { const name = narrow[i]; state.out += name; seen[name] += 1; }
  console.log(how, state.out.length, state.out.indexOf("\0"), state.out === "names:" + written.join(""));
}
