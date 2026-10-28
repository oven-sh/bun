import type { Candidate } from "./instances";
import type { Log } from "./log";
import type { Snapshot } from "./snapshots";
import type { OperandName } from "./table-description";

export type Completion = { kind: "Returned"; value: unknown } | { kind: "Threw"; error: unknown };
export type OperandSet = {
  name: string;
  receiver: Candidate;
  arguments: Candidate[];
  // How many of the last arguments no parameter of any overload takes.
  surplusCount: number;
};
export type Run = {
  set: OperandSet;
  log: Log;
  receiver: unknown;
  args: unknown[];
  completion: Completion;
  // The same operation once more on the same operands, where that is done.
  repeated: Completion | undefined;
  before: Snapshot;
  after: Snapshot;
  yielded: unknown[];
  hasChangedRegExpState: boolean;
};

export function candidateOf(set: OperandSet, operand: OperandName): Candidate | undefined {
  return operand === "this" ? set.receiver : set.arguments[operand];
}

export function valueOf(run: Run, operand: OperandName): unknown {
  return operand === "this" ? run.receiver : run.args[operand];
}

export function isReentrant({ receiver, arguments: candidates }: OperandSet): boolean {
  return !!receiver.isReentrant || candidates.some(candidate => candidate.isReentrant);
}
