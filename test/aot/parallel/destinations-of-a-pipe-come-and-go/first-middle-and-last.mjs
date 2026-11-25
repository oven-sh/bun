// unpipe() of a Readable with one, two, three and four destinations: the first, one in the middle, the last, one that is not there, one that is there twice; what is left, in which order, and who is told.
import { Readable, Writable } from "node:stream";

const make = count => {
  const source = new Readable({ read() {} });
  const sinks = Array.from({ length: count }, (_, i) => {
    const sink = new Writable({ write(chunk, encoding, done) { done(); } });
    sink.on("unpipe", (from, info) => console.log("    sink", i, "is told", from === source, JSON.stringify(info)));
    return sink;
  });
  for (const sink of sinks) source.pipe(sink);
  return { source, sinks };
};
const left = ({ source, sinks }) => source._readableState.pipes.map(sink => sinks.indexOf(sink)).join() || "none";

for (let count = 1; count <= 4; count++) {
  for (let gone = 0; gone < count; gone++) {
    const all = make(count);
    console.log(count, "destinations,", gone, "goes");
    const answer = all.source.unpipe(all.sinks[gone]);
    console.log("  left", left(all), "| flowing", all.source.readableFlowing, "| itself", answer === all.source, "| listeners of data", all.source.listenerCount("data"));
    all.source.unpipe(all.sinks[gone]);
    console.log("  again", left(all));
    for (let i = count - 1; i >= 0; i--) all.source.unpipe(all.sinks[i]);
    console.log("  all from the last", left(all), "| flowing", all.source.readableFlowing, all.source._readableState.pipes.length);
  }
}

console.log("one that was never there");
{
  const all = make(2);
  all.source.unpipe(new Writable());
  console.log("  left", left(all));
}
console.log("the same destination twice");
{
  const all = make(2);
  all.source.pipe(all.sinks[1]);
  console.log("  piped", left(all));
  all.source.unpipe(all.sinks[1]);
  console.log("  left", left(all));
  all.source.unpipe(all.sinks[1]);
  console.log("  left", left(all));
}
console.log("all at once");
{
  const all = make(3);
  all.source.unpipe();
  console.log("  left", left(all), all.source.readableFlowing);
}
console.log("a list that the program has filled by hand");
{
  const all = make(1);
  const told = { emit: (...args) => console.log("    told by hand", args[0], args.length) };
  all.source._readableState.pipes.push(1, told);
  all.source.unpipe(all.sinks[0]);
  console.log("  left", all.source._readableState.pipes.length, all.source._readableState.pipes[0]);
  all.source.unpipe(told);
  console.log("  left", all.source._readableState.pipes.length, all.source._readableState.pipes[0]);
}
