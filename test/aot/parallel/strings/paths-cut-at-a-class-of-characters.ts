const hidden = new Function("v", "return v") as <V>(v: V) => V;

type Stats = { isFile(): boolean; isDirectory(): boolean };
type Options = { ignored: (path: string, stats?: Stats) => boolean };
function watch(options: Options): (path: string) => boolean {
  return hidden((path: string) => options.ignored(path, undefined));
}
const isIgnored = watch({
  ignored: (path, stats) => {
    if (stats && !stats.isFile() && !stats.isDirectory()) return true;
    if (path.split(/[/\\]/).some(dir => dir === ".git")) return true;
    return false;
  },
});
function words(text: string): string[] { return text.toLowerCase().split(/\s+/); }
function parts(name: string): string[] { return name.split(/[:_-]/).filter(Boolean); }
function lines(text: string): string[] { return text.split(/\r\n?|\n/); }
function limited(text: string): string[] { return text.split(/[,;]/, 2); }
function captured(text: string): string[] { return text.split(/([,;])/); }

const paths = ["/home/user/project/src/index.ts", "/home/user/project/.git/HEAD", "C:\\Users\\me\\.git\\config", "relative/path", "", "/", "no-separator", "/très/loin/.git", "/日本語/のフォルダ/.git/x"];
const texts = ["Run the tests  and\treport", "", " leading and trailing ", "one", "a\nb\r\nc\rd", "x,y;z,,w", "skill:name_with-parts", "日本語 の テキスト"];
let digest = 0;
function note(pieces: string[]): void {
  digest = (digest * 31 + pieces.length) | 0;
  for (const piece of pieces) digest = (digest * 31 + piece.length + (piece.length ? piece.charCodeAt(0) : 0)) | 0;
}
const rounds = Number(process.argv[2] ?? 10);
for (let round = 0; round < rounds; round++) {
  for (const path of paths) {
    const copy = hidden(path.split("").join(""));
    digest = (digest * 31 + (isIgnored(copy) ? 1 : 0)) | 0;
    digest = (digest * 31 + (isIgnored(hidden("<" + copy + ">").slice(1, -1)) ? 1 : 0)) | 0;
  }
  for (const text of texts) {
    const copy = hidden(text.split("").join(""));
    note(words(copy)); note(parts(copy)); note(lines(copy)); note(limited(copy)); note(captured(copy));
  }
}
"a-b".split(/-/);
console.log(digest, paths.map(isIgnored).join(), JSON.stringify(words("A b  C")), JSON.stringify(parts("a:b_c-d")), JSON.stringify(captured("a,b;c")), RegExp.lastMatch, JSON.stringify(RegExp.leftContext));
