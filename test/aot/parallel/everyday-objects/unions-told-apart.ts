// Records of a union told apart by a field, in a list
type Event = { kind: "click"; x: number; y: number } | { kind: "key"; key: string; repeat?: boolean } | { kind: "wheel"; by: number };
function handle(events: Event[]): string {
  let at = 0;
  const out: string[] = [];
  for (const event of events) {
    switch (event.kind) {
      case "click":
        out.push(`${event.x},${event.y}`);
        at += event.x - event.y;
        break;
      case "key":
        out.push(event.repeat ? event.key.repeat(2) : event.key);
        break;
      default:
        at += event.by;
    }
  }
  return out.join(" ") + " " + at;
}
console.log(handle([{ kind: "click", x: 1, y: 2 }, { kind: "wheel", by: 10 }]));
console.log(handle([{ kind: "key", key: "a", repeat: true }, { kind: "key", key: "b" }]));
console.log(handle([]));
