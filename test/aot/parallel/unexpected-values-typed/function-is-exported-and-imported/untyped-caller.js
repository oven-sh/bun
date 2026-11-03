import code, { halved, Scale, sum, total } from "./library.ts";

export function untypedCalls(log) {
  return [
    () => total("12"),
    () => total({ length: 2, 0: 1, 1: "2" }),
    () => total([1, , 3]),
    () => total(null),
    () => sum({ x: "1", y: 2 }),
    () => sum({ get x() { log.push("get-x"); return 1; }, y: 2 }),
    () => sum(5),
    () => code(["a"]),
    () => code(65),
    () => halved("8"),
    () => halved(8n),
    () => halved({ valueOf() { log.push("valueOf"); return 8; } }),
    () => new Scale("3").apply(2),
    () => new Scale(3).apply("2"),
    () => new Scale(3).apply.call({ factor: "f" }, 2),
    () => Scale(3),
  ];
}
