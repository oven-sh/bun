// src/mood.ts
declare enum Mood2 {
  Happy,
  Sad = 5,
}
type Options = Mood2[];
type Options2 = { name: string; loud?: boolean };
interface Greeter<T extends Options2 = Options2> {
  greet(options: T): string;
}
type Mood = Mood2;
declare namespace Mood { export type Happy = Mood2.Happy; export type Sad = Mood2.Sad; }
export type { Server };
export type { Options2 as Options };
var Mood!: typeof Mood2;
((Mood: any) => {
  Mood[Mood["Happy"] = 0] = "Happy";
  Mood[Mood["Sad"] = 5] = "Sad";
})(Mood ||= {} as any);

// src/polite.ts
class Polite implements Greeter {
  public mood: Mood2;
  private moods?: Options;
  private count: number = 0;
  readonly prefix: string;
  static made = 0;
  constructor(prefix: string, mood: Mood2 = 0 as Mood2.Happy /* Happy */, moods?: Options) {
    this.mood = mood;
    this.moods = moods;
    this.prefix = prefix;
  }
  greet(options: Options2): string;
  greet(options: Options2, times: number): string[];
  greet(options: Options2, times?: number): string | string[] {
    this.count++;
    const text = (options.loud ? options.name.toUpperCase() : options.name) as string;
    const line = this.prefix + " " + text!;
    return times === undefined ? line : new Array<string>(times).fill(line);
  }
  get total(): number {
    return this.count + (this.moods ?? []).length;
  }
}

// src/index.ts
interface Server {
  port: number;
  options: Options2;
  greeter?: Greeter;
}
function pick({ port, options }: Server, fallback: number = 80): [number, Options2] {
  return [port ?? fallback, options];
}
function serve<S extends Server>(server: S, ...rest: string[]): string {
  const [port, options] = pick(server);
  const greeter: Greeter = server.greeter ?? new Polite("hello", 5 as Mood2.Sad /* Sad */);
  const seen = new Map<string, number>;
  seen.set(options.name, rest.length);
  const handlers: Array<(options: Options2) => string> = [(options) => greeter.greet(options), function(this: void, options: Options2) {
    return options.name;
  }];
  return handlers.map((handler) => handler(options)).join(",") + port + (seen.get(options.name) as number);
}
export {
  Mood,
  Polite,
  serve
};

