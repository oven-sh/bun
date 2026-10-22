interface Gadget {
  name: string;
  run(input: string): string;
  isEnabled(): boolean;
  isReadOnly(): boolean;
  label(): string;
}
type Definition = { name: string; run(input: string): string; isEnabled?(): boolean; isReadOnly?(): boolean };
const DEFAULTS = { isEnabled: () => true, isReadOnly: () => false };

function build<D extends Definition>(definition: D): Gadget {
  const facing = {
    run(input: string) {
      return definition.run(input) + "!";
    },
  };
  const built: Gadget = Object.assign(
    Object.defineProperties({ ...DEFAULTS, label: () => definition.name }, Object.getOwnPropertyDescriptors(definition)),
    facing,
  ) as unknown as Gadget;
  return built;
}

function matches(gadget: Gadget, name: string) {
  return gadget.name === name;
}

const gadgets = [build({ name: "a", run: text => text }), build({ name: "b", run: text => text + text, isReadOnly: () => true })];
let hits = 0;
for (let turn = 0; turn < 1000; turn++) for (const gadget of gadgets) if (matches(gadget, "b") && gadget.isReadOnly()) hits++;
console.log(hits, gadgets.map(gadget => gadget.label() + gadget.run("x") + gadget.isEnabled()).join());
