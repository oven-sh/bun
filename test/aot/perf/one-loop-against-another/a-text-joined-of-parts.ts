// A short text is joined of three parts and read by a pattern. One loop runs in a process that has looked nothing up under a computed name, the other behind one such look.
const paths: string[] = ["/orders", "/items", "/carts", "//elsewhere"];
const queries: string[] = ["?page=2", "", "?q=tea", ""];
const fragments: string[] = ["", "#top", "", "#end"];
const startsWithTwoSlashes = /^\/\//;
function hrefOf(path: string, query: string, fragment: string): string {
  return path + query + fragment;
}
const makers = [hrefOf];
function joined(turns: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const href = makers[0]!(paths[i & 3]!, queries[i & 3]!, fragments[i & 3]!);
    sum = (sum + href.length + (startsWithTwoSlashes.test(href) ? 1 : 0)) | 0;
  }
  return sum;
}
const loop = process.argv[2] ?? "nothing was looked up";
const settings: Record<string, number> = JSON.parse('{"level2":1,"level4":2}');
const level = loop === "behind a look under a computed name" ? settings["level" + process.argv.length] : 0;
console.log(joined(Number(process.argv[3] ?? "5000")), typeof level);
export {};
