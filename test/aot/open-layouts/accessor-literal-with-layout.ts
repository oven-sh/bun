function memoizeOne<A extends object, T>(callback: (argument: A) => T): (argument: A) => T {
  const known = new Map<A, T>();
  return argument => {
    let value = known.get(argument);
    if (value === undefined) {
      value = callback(argument);
      known.set(argument, value);
    }
    return value;
  };
}

interface Rules {
  depth: number;
}
interface Factory {
  readonly rules: Rules;
  make(kind: number): number;
  count: number;
}
let built = 0;
function rulesOf(): Rules {
  built++;
  return { depth: built };
}
function createFactory(): Factory {
  const factory: Factory = {
    get rules() {
      return rulesOf();
    },
    make(kind) {
      factory.count++;
      return kind + factory.rules.depth;
    },
    count: 0,
  };
  return factory;
}
function createHelpers(factory: Factory): { twice(): number } {
  return {
    twice() {
      return factory.make(1) + factory.make(2);
    },
  };
}
const helpersOf = memoizeOne(createHelpers);
const factory = createFactory();
console.log(helpersOf(factory).twice(), factory.count, factory.rules.depth, Object.keys(factory).join());

interface Tools {
  add(a: number, b: number): number;
  twice(a: number): number;
  name: string;
}
let created = 0;
function binary(by: number): (a: number, b: number) => number {
  created++;
  return (a, b) => (a + b) * by;
}
function createTools(): Tools {
  const tools: Tools = {
    get add() {
      return binary(1);
    },
    get twice() {
      const add = tools.add;
      return (a: number) => add(a, a);
    },
    name: "tools",
  };
  return tools;
}
function useTools(tools: Tools): number {
  return tools.add(1, 2) + tools.twice(5);
}
const used = memoizeOne(useTools);
const tools = createTools();
console.log(used(tools), useTools(tools), created, tools.name, tools.add === tools.add);

interface Sink {
  value?: number;
  seen: number;
}
function createSink(): Sink {
  const sink: Sink = {
    set value(given: number | undefined) {
      sink.seen += given ?? 0;
    },
    seen: 0,
  };
  return sink;
}
function feed(sink: Sink): number {
  sink.value = 4;
  sink.value = 5;
  return sink.seen;
}
const fed = memoizeOne(feed);
const sink = createSink();
console.log(fed(sink), sink.value, sink.seen, Object.keys(sink).join());

interface Control {
  control: number;
}
const control: Control = JSON.parse('{"control":1}');
console.log(control.control);
