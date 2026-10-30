// A member of a union of texts stands in the type alone. Eight Workers and the main thread each get a text equal to it in a message, all at once, store it into a typed field, read, compare and print it; half of them first meet a text that is no member
type Color = "red" | "amber" | "green";
class Signal { color: Color = "red"; }
function letter(color: Color): string {
  switch (color) {
    case "red": return "R";
    case "green": return "G";
    default: return "other:" + color;
  }
}
function same(a: Color, b: Color): boolean { return a === b; }
function meet(texts: string[]): string {
  const signal = new Signal();
  let line = "";
  for (let round = 0; round < 2000; round++) {
    for (const text of texts) {
      const before = signal.color;
      signal.color = text as Color;
      if (round % 1999 === 0) line += letter(signal.color) + ":" + same(signal.color, before) + ":" + same(signal.color, (text + "").slice(0) as Color) + ":" + JSON.stringify(signal) + " ";
    }
  }
  return line;
}

if (Bun.isMainThread) {
  const pieces: string[] = JSON.parse('["am","ber","pi","nk","gre","en"]');
  const member = pieces[0] + pieces[1], other = pieces[2] + pieces[3], spelled = pieces[4] + pieces[5];
  const workers = Array.from({ length: 8 }, () => new Worker(new URL(import.meta.url)));
  const answers = workers.map((worker, id) => new Promise<string>(resolve => {
    worker.onmessage = event => resolve(id + " " + event.data);
    worker.postMessage(id & 1 ? [other, member, spelled] : [member, spelled, other]);
  }));
  console.log("main " + meet([member, other, spelled]));
  for (const answer of await Promise.all(answers)) console.log(answer);
  for (const worker of workers) worker.terminate();
} else {
  self.onmessage = event => postMessage(meet(event.data));
}
