// Array literals without a written type: constants of a module, a function and a class, fields of objects, results of functions.
const source: any[][] = [[1, 2, 3, 4], [0.5, 1.5, 2.5, 3.5], [1, 2, 0.5, 4], [-0, 1, NaN, 2], [2147483647, -2147483648, 2147483648, 0], [1, "t", 3, 4], [1, undefined, null, 4], [true, [1], { valueOf: () => 2 }, 4]];
function show(v: any): string {
  if (Array.isArray(v)) return "[" + Array.from(v, (x, i) => i in v ? show(x) : "_").join() + "]";
  return Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : v !== null && typeof v === "object" ? "{}" : String(v);
}
let list: number[] = source[0]!;
function made() { return [list[0]!, list[1]!, list[2]!, list[3]!]; }
class Box { items = [list[0]!, list[1]!]; constant = [1, 2, 3]; }
const stores: ((few: any) => void)[] = [() => {}, few => { few[0] = 0.5; }, few => { few[0] = "s"; }, few => { few[1] = undefined; }, few => { few.push(1.5); }, few => { few.length = 1; }, few => { delete few[0]; }, few => { few[0] = -0; }, few => { few[0] = 4294967296; }];
for (const [at, values] of source.entries()) {
  list = values;
  const lines: string[] = [];
  for (const store of stores) {
    for (let round = 0; round < 3; round++) {
      const plain = [list[0]!, list[1]!, list[2]!];
      const nested = [[list[0]!, list[1]!], [list[2]!, 4]];
      const spread = [...list, list[0]!];
      const either = list.length > 3 ? [list[0]!, list[3]!] : [];
      const box = new Box(), result = made(), record = { few: [list[1]!, list[2]!], tag: at };
      const constant = [1, 2, 3, 4];
      const read = () => {
        const out: any[] = [];
        for (const few of [plain, nested[0]!, spread, either, box.items, box.constant, result, record.few, constant]) {
          let whole = 0, sum: any = 0;
          for (let i = 0; i < few.length; i++) whole = (whole + few[i]!) | 0;
          for (let i = 0; i < 8; i++) sum += few[i & 1]!;
          out.push(whole, show(sum));
        }
        return out.join();
      };
      const first = read();
      for (const few of [plain, nested[0]!, spread, either, box.items, box.constant, result, record.few, constant]) store(few);
      lines.push(first + " " + read() + " " + show([plain, nested, spread, either, box.items, box.constant, result, record.few, constant]));
    }
  }
  let digest = 0;
  for (const line of lines) for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0;
  console.log(at, digest, lines[4]);
}
