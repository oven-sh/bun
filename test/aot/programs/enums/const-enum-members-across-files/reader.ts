import { Kind, Name, Plain } from "./kinds";
import { Kind as ThroughStar, Sort } from "./again";
import * as all from "./again";
export function read(): unknown[] { return [Kind.Number, Kind["Text"], ThroughStar.Number, Sort.Both, all.Kind.Flag, Name.Left, Plain.One]; }
export function describe(kind: number): string {
  switch (kind) {
    case Kind.Word: return "word";
    case ThroughStar.Number: return "number";
    case Sort.Text: return "text";
    case all.Kind.Both: return "both";
    default: return "other";
  }
}
export function readByKey(key: string): unknown { return (all as any).Kind[key]; }
