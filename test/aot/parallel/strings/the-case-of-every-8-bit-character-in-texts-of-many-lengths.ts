// toLowerCase and toUpperCase of texts of 8-bit characters go sixteen characters a step: every 8-bit character at every place of a step, texts shorter and longer than a step,
// the letters whose capital or small form is no 8-bit character, and a neighbor of 16 bits.
function digest(text: string): number {
  let sum = 0;
  for (let k = 0; k < text.length; k++) sum = (Math.imul(sum, 31) + text.charCodeAt(k)) | 0;
  return sum;
}
let every = "";
for (let code = 0; code < 256; code++) every += String.fromCharCode(code);
const lines: string[] = [];
for (const length of [0, 1, 2, 7, 15, 16, 17, 31, 32, 33, 63, 64, 65, 100, 255, 256, 257, 1000, 4099]) {
  for (const start of [0, 1, 65, 97, 128, 181, 192, 215, 223, 255]) {
    let text = "";
    while (text.length < length) text += every.slice(start) + every.slice(0, start);
    text = text.slice(0, length);
    const ascii = text.replace(/[\u0080-ÿ]/g, "x");
    lines.push([length, start, digest(text.toLowerCase()), digest(text.toUpperCase()), text.toUpperCase().length, digest(ascii.toLowerCase()), digest(ascii.toUpperCase()), digest((text + "İ").toLowerCase()), text.toLowerCase() === text, ascii.toUpperCase() === ascii].join(" "));
  }
}
for (let code = 0; code < 256; code++) lines.push(code + " " + String.fromCharCode(code).toLowerCase().charCodeAt(0) + " " + digest(String.fromCharCode(code).toUpperCase()));
console.log(lines.length, digest(lines.join("\n")));
console.log(lines.join("\n"));
