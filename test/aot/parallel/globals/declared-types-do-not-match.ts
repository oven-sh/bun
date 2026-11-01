// Typed code reads globals whose values don't match their declared types.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
declare var level: number;
declare var label: string;
declare var settings: { depth: number };
const world = globalThis as any;
world.level = 1;
world.label = "one";
world.settings = { depth: 1 };
function total(rounds: number): number {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum += level;
  return sum;
}
function describe(): string {
  return label + "/" + settings.depth + "/" + typeof level;
}
function show(): void {
  try {
    console.log(String(total(3)), describe());
  } catch (error) {
    console.log(error instanceof TypeError ? error.name : (error as Error).name + ": " + (error as Error).message);
  }
}
show();
show();
world.level = "text";
show();
world.level = 2.5;
world.label = 5;
show();
world.settings = { depth: "deep", more: true };
show();
world.settings = undefined;
show();
world.settings = { depth: 2 };
level = 4;
label = "stored by name";
show();
console.log(world.level, world.label);
delete world.level;
show();
export {};
