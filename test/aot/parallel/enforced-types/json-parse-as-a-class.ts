// `JSON.parse(text) as Config`: an ordinary object with the members of the class, and with some of another type, goes wherever a Config is written: into a parameter, into a field, through a method that it does not have.
// Under: --aot-testing=CheckProofsAtRunTime: the type that a slot is held to
class Config {
  depth: number;
  name: string;
  strict: boolean;
  constructor(depth: number, name: string, strict: boolean) {
    this.depth = depth;
    this.name = name;
    this.strict = strict;
  }
  describe(): string {
    return this.name + ":" + (this.depth + 1) + ":" + (this.strict ? "strict" : "loose");
  }
}
class Session {
  config: Config;
  constructor(config: Config) {
    this.config = config;
  }
}
function attempt(read: () => unknown): string {
  try {
    return String(read());
  } catch (error) {
    return (error as Error).name;
  }
}
function show(session: Session): string {
  return attempt(() => session.config.describe()) + " " + attempt(() => session.config.depth + 1) + " " + attempt(() => session.config.name.length) + " " + (session.config instanceof Config);
}
const parsed = JSON.parse('{ "depth": "deep", "name": 5, "strict": "yes" }') as Config;
const straight = new Session(new Config(1, "one", true));
console.log("before", show(straight));
straight.config = parsed;
console.log("behind", show(straight));
console.log("made with it", show(new Session(parsed)));
straight.config = new Config(2, "two", false);
console.log("honest again", show(straight));
for (let turn = 0; turn < 3; turn++) {
  const session = new Session(turn === 1 ? parsed : new Config(turn, "turn", turn === 0));
  console.log(turn, show(session));
}
