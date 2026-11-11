function scan(text: string, map: Map<string, any>): string {
  let out = "";
  for (let i = 0; i + 7 <= text.length; i++) {
    const held = map.get(text.substring(i, i + 7));
    if (held !== undefined) out += i + "=" + held + " ";
  }
  return out;
}
let text = "";
for (const part of ["..v4fe472", "..v4fe473", ".."]) for (let i = 0; i < part.length; i++) text += String.fromCharCode(part.charCodeAt(i));
const map = new Map<string, any>();
map.set("v4fe472", 1); map.set("v4fe473", 2);
console.log(scan(text, map));
