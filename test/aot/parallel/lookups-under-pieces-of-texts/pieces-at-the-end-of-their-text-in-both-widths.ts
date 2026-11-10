function make(length: number, seed: number, first: number): string {
  let text = String.fromCharCode(first, 46, 46);
  for (let i = 0; i < length; i++) { seed = (seed * 3877 + 29573) % 139968; text += String.fromCharCode(33 + (seed % 220)); }
  return text;
}
function look(text: string, length: number, map: Map<string, number>): number {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const held = map.get(text.substring(3, 3 + length));
  return held === undefined ? -1 : held + work;
}
function run(most: number): number {
  let sum = 0;
  for (let length = 0; length <= most; length++) {
    const narrow = make(length, 7 + length, 46), wide = make(length, 7 + length, 0x4e00);
    const ofNarrow = new Map<string, number>([[make(length, 7 + length, 46).slice(3), length + 1]]);
    const ofWide = new Map<string, number>([[wide.slice(3), length + 1]]);
    const near = new Map<string, number>([[narrow.slice(3, 2 + length) + " ", length + 1]]);
    sum += look(narrow, length, ofNarrow) + look(wide, length, ofNarrow) + look(narrow, length, ofWide) + look(narrow, length, near);
  }
  return sum;
}
console.log("SAID", run(JSON.parse("70")));
