// a list is born with one value and filled up to the length of a text: its room is asked for once, in front of the loop.
const [eight, sixteen]: string[] = JSON.parse('["xxxxxxxx","xxxxxxxxxxxxxxxx"]');
let kept: number[] = [];
function fill(text: string, first: number): number {
  const list = [first];
  for (let i = 1; i <= text.length; i++) list.push(i + 1);
  kept = list;
  return list.length;
}
export const loops: Record<string, (n: number) => number> = {
  "seventeen values": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + fill(sixteen!, i)) | 0; return s + kept.length; },
  "nine values": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + fill(eight!, i)) | 0; return s + kept.length; },
};
