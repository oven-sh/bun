// Both in one class: a default that reads an enum, a read right behind the `{` of the constructor and right behind super(..).
enum Mode { Off = 0, On = 1, Name = "mode" }
const seen: unknown[] = [];
// prettier-ignore
// @ts-expect-error
class Switch{constructor(public mode = Mode.On, readonly name = Mode.Name){Mode.On&&seen.push(mode)}}
// prettier-ignore
// @ts-expect-error
class Dimmer extends Switch{constructor(public level = Mode.Off){super(Mode.Off);Mode.On&&seen.push(level)}}
const AgainSwitch = (0, eval)("(function (seen) { return (" + String(Switch) + "); })")(seen);
const AgainDimmer = (0, eval)("(function (Switch, seen) { return (" + String(Dimmer) + "); })")(AgainSwitch, seen);
console.log(JSON.stringify([new Switch(), new AgainSwitch(), new Dimmer(), new AgainDimmer(), seen]));
