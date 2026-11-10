// The typed twin: the text is proven to be a string, so no test stands in front of the scan.
// STATISTIC: URLsLeftUnbuilt >= 1
const data: { from: number, texts: string[] } = JSON.parse('{"from":0,"texts":["https://a.example/z?d=e","https://a.example/c?d=f%20g"]}');
function read(first: string, second: string, from: number, turns: number, call: () => void) {
  for (let i: number = from; i < turns; i = i + 1) { const kept = first; first = second; second = kept; }
  const url = new URL(first);
  try {
    call();
    return url.pathname;
  } catch {
    return url.searchParams.get("d");
  }
}
(globalThis as any).handed = [read];
for (let turns = 0; turns < 4; turns++) console.log(read(data.texts[0], data.texts[1], data.from, turns, () => { throw 1; }), read(data.texts[0], data.texts[1], data.from, turns, () => {}));
