// A text that grows, a decoder, and a source that is closed: the shape of a function that streams lines.
function mayThrow(text) { if (text.includes("!")) throw new Error("bad line"); return text; }
async function* chunks(list) { try { for (const chunk of list) yield chunk; } finally { console.log("chunks closed"); } }
async function* lines(input) {
  let rest = "";
  let decoder = new TextDecoder();
  try {
    for await (const chunk of input) {
      rest += decoder.decode(chunk, { stream: true });
      let at;
      while ((at = rest.indexOf("\n")) >= 0) {
        const line = rest.slice(0, at);
        rest = rest.slice(at + 1);
        yield mayThrow(line);
      }
    }
    if (rest) yield rest;
  } finally {
    decoder = null;
    rest = null;
    await 0;
  }
}
const bytes = text => new TextEncoder().encode(text);
for (const list of [["a\nb", "c\nd"], ["a\nb!\n", "c\n"]]) {
  try { for await (const line of lines(chunks(list.map(bytes)))) console.log("line", line); } catch (error) { console.log("caught", error.message); }
}
