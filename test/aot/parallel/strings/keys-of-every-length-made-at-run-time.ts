// Keys made at run time that equal, or nearly equal, names the program mentions: 8 and 16 bits, every length up to
// two words, on the main thread and in a worker.
const nothing = process.argv.length > 99 ? "x" : "";
const made = (text: string) => [...text].join(nothing);

const record: Record<string, number> = { alpha: 1, "näme": 2, "日本": 3, "": 4, a: 5, ab: 6, abc: 7, abcd: 8, "ÿ": 9 };
record.abcdefgh = 10;
record.abcdefghi = 11;
record.abcdefghijklmnopq = 12;

const present = "alpha näme 日本 a ab abc abcd ÿ abcdefgh abcdefghi abcdefghijklmnopq".split(" ");
const absent = "alphb alph alphaa näm 日 b abcdefgx abcdefghx abcdefghijklmnopx".split(" ");
const inherited = "toString constructor __proto__ length".split(" ");
for (const key of ["", ...present, ...absent, ...inherited]) {
  const same = record[made(key)] === record[key];
  console.log(
    JSON.stringify(key),
    same,
    typeof record[made(key)],
    made(key) in record,
    Object.hasOwn(record, made(key)),
  );
}

const fresh: Record<string, number> = {};
for (const key of Object.keys(record)) fresh[made(key)] = record[key];
console.log(JSON.stringify(fresh) === JSON.stringify(record), Object.keys(fresh).join("|"));
console.log(Symbol.for(made("alpha")) === Symbol.for("alpha"), Symbol.for(made("none of these")).description);
console.log(JSON.stringify(JSON.parse(made('{"alpha":1,"beta":2,"日本":3,"":4}'))));

class Point {
  x = 1;
  y = 2;
  sum() {
    return this.x + this.y;
  }
}
const point: any = new Point();
console.log(point[made("x")], point[made("sum")](), point[made("z")], Reflect.ownKeys(point).join());

if (Bun.isMainThread) {
  const worker = new Worker(import.meta.url);
  worker.onmessage = event => {
    console.log("worker:", event.data);
    worker.terminate();
  };
} else {
  postMessage([record[made("alpha")], record[made("日本")], made("abcdefghi") in record, made("no") in record].join());
}
