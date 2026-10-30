// Arguments of built-ins that are read out of fields declared string, function and list, of records whose contents come out of JSON.parse: split, forEach, new Error, padStart, join and replace answer as with literals, also where a field holds undefined, null or something of another type after all.
interface Options { separator: string; onDone: (n: number) => void; message: string; fill: string; names: string[] }
function run(text: string, opts: Options, xs: number[]): number {
  xs.forEach(opts.onDone);
  return text.split(opts.separator).length + new Error(opts.message).message.length + text.padStart(8, opts.fill).length + opts.names.join(opts.separator).length + text.replace(opts.separator, opts.fill).length;
}
const input: any = JSON.parse(process.argv[2] ?? '{"text":"a,b","sep":",","xs":[1,2],"m":"boom","fill":"*","names":["x","y"]}');
let sum = 0, total = 0;
const callbacks: any = { add: (n: number) => { sum += n; } };
const options: Options[] = [];
for (let i = 0; i < 4; i++) options.push({ separator: input.sep, onDone: callbacks.add, message: input.m, fill: input.fill, names: input.names });
for (let i = 0; i < 20000; i++) total += run(input.text, options[i & 3], input.xs);
console.log(total, sum);
const odd: any[] = [{ separator: undefined, onDone: callbacks.add, message: undefined, fill: undefined, names: ["x", "y"] }, { separator: null, onDone: callbacks.add, message: null, fill: null, names: ["x", "y"] }, { separator: 5, onDone: callbacks.add, message: 7, fill: 9, names: ["x", "y"] }, { separator: /,/, onDone: callbacks.add, message: { toString() { return "made"; } }, fill: ["-"], names: ["x", "y"] }];
for (const each of odd) console.log(run(input.text, each, input.xs), input.text.split(each.separator).join("|"), new Error(each.message).message, input.text.padStart(8, each.fill), each.names.join(each.separator), input.text.replace(each.separator, each.fill));
