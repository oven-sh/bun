function scan(text: string, map: Map<string, any>): string {
  let out = "";
  for (let length = 2; length <= 5; length++) {
    for (let i = 0; i + length <= text.length; i++) {
      const held = map.get(text.substring(i, i + length));
      if (held !== undefined) out += i + ":" + length + "=" + held + " ";
    }
  }
  return out;
}
let text = "";
for (const part of ["..k128z", "..k146z", "..k87z", "..k5z", ".."]) for (let i = 0; i < part.length; i++) text += String.fromCharCode(part.charCodeAt(i));
const longer = new Map<string, any>();
longer.set("k128z", 1); longer.set("k146z", 2); longer.set("k87z", 3); longer.set("k5z", 4);
console.log(scan(text, longer));
const shorter = new Map<string, any>();
shorter.set("k128", 1); shorter.set("k146", 2); shorter.set("k87", 3); shorter.set("k5", 4);
console.log(scan(text, shorter));
