// TypeScript compares method parameters bivariantly, so a class method may require more of a parameter than the interface it implements, or the class it extends, declares. A call through the interface can then pass an object that lacks a member the method requires. The program must behave as it does in plain JavaScript.
type Trust = { attested: boolean; decidedByHost: boolean };
type Part = Pick<Trust, "attested">;
const NONE: Trust = { attested: false, decidedByHost: false };
interface Policy {
  name: string;
  check(tool: string, call?: Part): string;
}
function run(p: Policy, attested: boolean): string {
  return p.name + ": " + p.check("ls", { attested }) + " | " + p.check("rm") + " | " + p.check("cp", { attested, decidedByHost: true } as Part);
}

class Implements implements Policy {
  name = "implements";
  check(tool: string, call: Trust = NONE): string {
    return tool + " " + call.attested + " " + call.decidedByHost + " " + ("decidedByHost" in call);
  }
}
class Base {
  name = "base";
  check(tool: string, call?: Part): string {
    return tool + " " + call?.attested;
  }
}
class Overrides extends Base {
  name = "overrides";
  check(tool: string, call: Trust = NONE): string {
    const { attested, decidedByHost = "not decided" } = call as Partial<Trust>;
    return tool + " " + attested + " " + decidedByHost + " " + Object.keys(call).join();
  }
}
class Further extends Overrides {
  name = "further";
}
class NeverReads implements Policy {
  name = "never reads it";
  check(tool: string, _call: Trust = NONE): string {
    return tool;
  }
}

for (const policy of [new Implements(), new Base(), new Overrides(), new Further(), new NeverReads()]) console.log(run(policy, true));
console.log(new Implements().check("by its class", { attested: true, decidedByHost: false }), new Overrides().check("by its class"));
