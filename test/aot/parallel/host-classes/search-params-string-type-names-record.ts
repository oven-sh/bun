// URLSearchParams parses a string, whatever the type of the value that it is given says.
function counted(init: Record<string, string>): number {
  const size = new URLSearchParams(init).size;
  return size * 100;
}
function countedBesideRead(init: Record<string, string>): number {
  const first = init.a;
  const size = new URLSearchParams(init).size;
  return size * 100 + (first ? 1 : 0);
}
function textOf(init: string[][]): string {
  const length = init.length;
  const answer = new URLSearchParams(init).toString();
  return answer + "|" + length;
}
function copied(init: URLSearchParams): string {
  const size = init.size;
  const answer = new URLSearchParams(init).toString();
  return answer + "|" + size;
}
function countedOfNumber(init: number): number {
  const half = init / 2;
  const size = new URLSearchParams(init as any).size;
  return size * 100 + (half > 0 ? 1 : 0);
}
function pathOf(init: URL): string {
  const href = init.href;
  const answer = new URL(init).pathname;
  return answer + "|" + href;
}
const query: any = process.argv[2] ?? "a=1&b=2";
console.log(counted(query), countedBesideRead(query), textOf(query), copied(query), countedOfNumber(query));
const address: any = process.argv[3] ?? "http://host.example/a/b";
console.log(pathOf(address));
