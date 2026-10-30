// TODO: functions that change an operand and that the table cannot describe yet. Each is a hole in what the compiler believes.
import type { OperandUse } from "../differential/table-description";

const storesIntoReceiver: OperandUse[] = ["StoresByKey"];
const makesReceiverAnEmitter: OperandUse[] = ["DefinesName", "StoresByKey"];
const definesOnNewInstance: OperandUse[] = ["DefinesName", "StoresByKey"];

export const knownChanges: ReadonlyMap<string, readonly OperandUse[]> = new Map([
  // Functions of Bun's own modules, written in JavaScript: EventEmitter.call(object). The worker has loaded node:domain, so it defines `domain` too.
  ["NodeEvents/0", makesReceiverAnEmitter],
  ["NodeStream/0", makesReceiverAnEmitter],
  ["Node_stream_wrap/0", makesReceiverAnEmitter],
  // With another constructor as the receiver they fill what it constructs.
  ["ArrayFrom/4", definesOnNewInstance],
  ["ArrayFromAsync/1", definesOnNewInstance],
  ["ArrayOf/1", definesOnNewInstance],
  // It defines the matchers on expect itself and on the prototypes behind it.
  ["ExpectExtend/0", storesIntoReceiver],
]);
