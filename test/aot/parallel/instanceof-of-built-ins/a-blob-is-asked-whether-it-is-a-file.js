// `x instanceof File`: the host's File answers by a look at the blob behind the value, and not by a walk up the chain.
function isFile(x) { return x instanceof File; }
function isBlob(x) { return x instanceof Blob; }
function countFiles(x, n) { let s = 0; for (let i = 0; i < n; i++) { if (x instanceof File) s++; } return s; }

function deed(kind) {
  if (kind === 0) return new File(["a"], "a.txt");
  if (kind === 1) return new Blob(["a"]);
  if (kind === 2) return Object.create(File.prototype);
  if (kind === 3) return Bun.file("no-such-file.txt");
  return {};
}
for (let kind = 0; kind < 5; kind++) console.log(String(kind), String(isFile(deed(kind))), String(isBlob(deed(kind))), String(countFiles(deed(kind), 100)));
let count = 0;
for (let i = 0; i < 200; i++) count += isFile(deed(i % 5)) ? 1 : 0;
console.log(String(count), String(isFile(null)), String(isFile("a.txt")));
