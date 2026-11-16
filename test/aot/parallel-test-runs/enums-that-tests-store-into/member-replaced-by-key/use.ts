import { Kind } from "./kinds";
import { Kind as Renamed } from "./barrel";
import * as kinds from "./kinds";
export function all(value: unknown) {
  let arm = "none";
  switch (value) {
    case Kind.First:
      arm = "first";
      break;
    case Kind.Second:
      arm = "second";
  }
  return [Kind.First, Kind["First"], Renamed.First, kinds.Kind.First, Kind.Second, Kind.First === (1 as any), arm].join();
}
