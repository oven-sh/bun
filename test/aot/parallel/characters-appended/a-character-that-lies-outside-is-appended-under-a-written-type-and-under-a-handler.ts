function claimed(text: string): string {
  let out = "";
  for (let i = 0; i <= text.length; i++) out += text[i]!;
  return out;
}
function named(text: string): string {
  let out = "";
  for (let i = -1; i <= text.length; i++) {
    const c: string = text[i] as string;
    const d = text.charAt(i);
    out += c;
    out += d;
  }
  return out;
}
function underHandler(text: string, stop: number): string {
  let out = "";
  try {
    for (let i = 0; i <= text.length; i++) {
      out += "<" + text[i] + text.charAt(i) + ">";
      if (i === stop) throw new Error("stop");
    }
  } catch {
    return out + "!";
  }
  return out;
}
for (const text of ["ab", "", "Жÿ", "x".repeat(200)]) console.log(claimed(text).slice(-14), named(text).slice(-24), underHandler(text, 1).slice(-24), underHandler(text, 500).slice(-24));
