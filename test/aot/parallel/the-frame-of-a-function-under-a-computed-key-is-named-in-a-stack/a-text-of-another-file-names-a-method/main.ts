// A library trims its own frames out of a stack by the NAME of its methods, which stand under computed keys.
import { step } from "./key";

function fail(): string {
  return new Error("made up").stack ?? "";
}

const written = {
  kind: "written",
  [step](value: number): string {
    const stack = fail();
    return value > 0 ? stack : "";
  },
};

function make(extra: Record<string, unknown>) {
  return { ...extra };
}
const handedOn = make({
  kind: "handed on",
  [step](value: number): string {
    const stack = fail();
    return value > 0 ? stack : "";
  },
}) as typeof written;

class Stepper {
  [step](value: number): string {
    const stack = fail();
    return value > 0 ? stack : "";
  }
}

const short = (stack: string) =>
  stack
    .split("\n")
    .slice(1, 3)
    .map(line => line.replace(/\(.*[/\\]/, "(").trim())
    .join(" | ");
for (const [name, holder] of [["literal", written], ["handed on", handedOn], ["class", new Stepper()]] as const) {
  console.log(name + ":", short(holder[step](1)), "| .name:", holder[step].name);
}
