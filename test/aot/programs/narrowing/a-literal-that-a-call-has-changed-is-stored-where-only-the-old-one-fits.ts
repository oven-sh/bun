// To the checker the variable still holds the literal that was stored, and a position that takes only that literal takes the variable. The call has stored another
// literal. Whatever reads the position has to see the value that is there.
let held: "a" | "b" = "a";

function change(): void {
  held = "b";
}

let inModule: "a" = "a";

class Box {
  field: "a" = "a";
}

function name(word: "a"): string {
  return word === "a" ? "first" : "second";
}

function returned(): "a" {
  held = "a";
  change();
  return held;
}

function run(box: Box): string {
  let captured: "a" = "a";
  const read = (): string => (captured === "a" ? "first" : "second");
  held = "a";
  change();
  inModule = held;
  captured = held;
  box.field = held;
  const list: "a"[] = [held];
  const lines = [
    inModule === "a" ? "first" : "second",
    read(),
    box.field === "a" ? "first" : "second",
    name(held),
    returned() === "a" ? "first" : "second",
    list[0] === "a" ? "first" : "second",
    inModule + captured + box.field + list[0],
  ];
  return lines.join(" ");
}

for (let turn = 0; turn < 3; turn++) console.log(run(new Box()));
