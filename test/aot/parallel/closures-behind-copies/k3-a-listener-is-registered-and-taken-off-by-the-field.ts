const target = new EventTarget();
function run(sources: Array<{ x: number; y: number }>): string {
  const said: Array<number | string> = []; let heard = 0;
  for (let i = 0; i < sources.length; i++) {
    said.push(i);
    let kept: (() => void) | undefined;
    const made = { tag: i, ...sources[i], stop: (kept = () => { heard++; }) };
    target.addEventListener("made-up", kept!);
    target.removeEventListener("made-up", made.stop);
  }
  target.dispatchEvent(new Event("made-up"));
  return said.join(" ") + " heard " + heard;
}
console.log(`${run([{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }, JSON.parse('{"y":7,"q":8}'), { x: 9, y: 10 }])}`);
export {};
