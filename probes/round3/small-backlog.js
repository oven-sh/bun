// stdout is a pipe whose reader starts late. First chunk: argv[2] bytes. Then "b".
const size = Number(process.argv[2]);
const order = [];
const r0 = process.stdout.write(Buffer.alloc(size, "a"), () => order.push("w0"));
const r1 = process.stdout.write("b", () => order.push("w1"));
const inside = order.slice();
process.stdout.write("", () => order.push("w2"));
setTimeout(() => process.stderr.write(JSON.stringify({ size, r0, r1, insideWrite: inside, order }) + "\n"), 1500);
