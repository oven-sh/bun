// A method call that expects instances of one class gets other classes, literals, parsed objects, functions, primitives, null. The method is looked up before the arguments run, `this` is the receiver, and what cannot be called throws after the arguments ran.
class Task {
  label = "task";
  run(first: number, second: number): string {
    return this.label + "(" + first + "," + second + ")";
  }
  toString(): string {
    return "Task " + this.label;
  }
}
class OtherTask {
  extra = 0;
  label = "other";
  run(first: number): string {
    return this.label + "<" + first + "," + arguments.length + ">";
  }
}
class StaticTask {
  static label = "static";
  static run(...all: number[]): string {
    return this.label + "[" + all.join() + "]";
  }
}

const trail: string[] = [];

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}
function noted(value: number): number {
  trail.push("argument " + value);
  return value;
}
function runIt(task: Task): string {
  return task.run(noted(1), noted(2));
}
function textOf(task: Task): string {
  return task.toString();
}
function look(mark: string, value: unknown): void {
  const task = value as Task;
  console.log(mark + ":", attempt(() => runIt(task)), "|", attempt(() => runIt(task)), "|", attempt(() => textOf(task)), "|", trail.splice(0).join(";"));
}

function plainFunction() {}
plainFunction.run = function (this: unknown, first: number, second: number) {
  return (this === plainFunction) + " " + (first + second);
};
plainFunction.toString = () => "a function with members";

look("expected", new Task());
look("another class", new OtherTask());
look("another class", new OtherTask());
look("expected", new Task());
look("a class with static members", Object.assign(StaticTask, { toString: () => "StaticTask" }));
look("a literal with a method", {
  label: "literal",
  run(this: { label: string }, first: number, second: number) {
    return this.label + "{" + first * second + "}";
  },
});
look("a literal with an arrow", { run: (first: number) => "arrow " + first });
look("a literal that borrows the method", { label: "borrower", run: Task.prototype.run });
look("a function", plainFunction);
look("an heir of an instance", Object.create(new Task(), { label: { value: "heir" } }));
look("no method", { label: "no method" });
look("parsed", JSON.parse('{"label":"parsed","run":5}'));
look("no prototype", Object.create(null));
look("expected", new Task());
look("null", null);
look("undefined", undefined);
look("a number", 5);
look("a text", "text");
look("a symbol", Symbol("s"));
look("a bigint", 5n);
look("true", true);
look("an array", [1, 2]);
look("expected", new Task());

export {};
