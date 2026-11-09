// URLSearchParams and URL take whatever they are given: a string is parsed, a record or a list of pairs is walked, anything else is turned into a string first.
function textOf(text: string): string {
  const unit = text.charCodeAt(1);
  const answer = new URLSearchParams(text).toString();
  return answer + unit;
}
function textBesideLastCharacter(text: string): string {
  const last = text[text.length - 1];
  const answer = new URLSearchParams(text).toString();
  return answer + (text[text.length - 1] === last ? "" : " moved");
}
function lookedUp(text: string): string {
  const length = text.length;
  const params = new URLSearchParams(text);
  return params.has("p") + "|" + params.get("p") + "|" + length;
}
function counted(text: string): number {
  const length = text.length;
  const size = new URLSearchParams(text).size;
  return size * 100 + length;
}
function listed(text: string): string {
  const length = text.length;
  const names: string[] = [];
  for (const [name, value] of new URLSearchParams(text)) names.push(name + ":" + value);
  return names.join() + "|" + length;
}
function pathOf(text: string): string {
  const length = text.length;
  const url = new URL(text);
  return url.pathname + "|" + url.search + "|" + url.searchParams.get("p") + "|" + length;
}
console.log(textOf(process.argv[2] ?? "a=1&b=2"));
console.log(textBesideLastCharacter(process.argv[2] ?? "a=1&b=2"));
console.log(lookedUp(process.argv[2] ?? "p=1&b=2"));
console.log(counted(process.argv[2] ?? "a=1&b=2"));
console.log(listed(process.argv[2] ?? "a=1&b=2"));
console.log(pathOf(process.argv[3] ?? "http://host.example/a/b?p=q"));

const record: any = JSON.parse(process.argv[4] ?? '{"p":"q","length":3}');
console.log(lookedUp(record), counted(record), listed(record));
const pairs: any = JSON.parse(process.argv[5] ?? '[["p","r"],["s","t"]]');
console.log(lookedUp(pairs), counted(pairs), listed(pairs));
const number: any = JSON.parse(process.argv[6] ?? "12345");
console.log(lookedUp(number), counted(number), listed(number));
const described: any = { length: 2, toString: () => "http://other.example/x/y?p=z" };
console.log(pathOf(described));
const measured: any = { charCodeAt: () => 7, p: "q" };
console.log(textOf(measured).length > 10);
