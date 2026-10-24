// Each call of the row takes what the call before it answers. The function that the last closure calls is named nowhere else.
class Command {
  private names: string[] = [];
  private actions: Array<(value: number) => number> = [];

  option(name: string): this {
    this.names.push(name);
    return this;
  }

  action(run: (value: number) => number): this {
    this.actions.push(run);
    return this;
  }

  run(start: number): string {
    let value = start;
    for (const action of this.actions) value = action(value);
    return `${this.names.length} options, ${this.names.at(-1)} last: ${value}`;
  }
}

class Total {
  constructor(public sum: number) {}
  doubled(): Total {
    return new Total(this.sum * 2);
  }
}

function reachedThroughTheLastClosureAlone(value: number): number {
  return new Total(value).doubled().sum + 7;
}

const command = new Command()
  .option("o1")
  .option("o2")
  .option("o3")
  .option("o4")
  .option("o5")
  .option("o6")
  .action(value => value + 6)
  .option("o7")
  .option("o8")
  .option("o9")
  .option("o10")
  .option("o11")
  .option("o12")
  .action(value => value + 12)
  .option("o13")
  .option("o14")
  .option("o15")
  .option("o16")
  .option("o17")
  .option("o18")
  .action(value => value + 18)
  .option("o19")
  .option("o20")
  .option("o21")
  .option("o22")
  .option("o23")
  .option("o24")
  .action(value => value + 24)
  .action(value => reachedThroughTheLastClosureAlone(value));

console.log(command.run(1));
