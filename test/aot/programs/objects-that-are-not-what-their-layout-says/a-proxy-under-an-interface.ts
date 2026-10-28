// A Proxy satisfies an interface: its traps answer
interface HasMessage {
  message: string;
}
function tell(x: HasMessage): string {
  return (
    x.message +
    "|" +
    Error.isError(x) +
    "|" +
    (x instanceof Error) +
    "|" +
    Object.keys(x).join() +
    "|" +
    ("message" in x)
  );
}
const proxy: HasMessage = new Proxy(
  { message: "target" },
  {
    get(t, k) {
      return k === "message" ? "trapped" : Reflect.get(t, k);
    },
    ownKeys() {
      return ["message", "more"];
    },
    getOwnPropertyDescriptor(t, k) {
      return { value: 1, enumerable: true, configurable: true };
    },
  },
);
const list: HasMessage[] = [{ message: "plain" }, proxy, new Proxy(new Error("under"), {})];
for (let round = 0; round < 3; round++) for (const x of list) console.log(tell(x));
