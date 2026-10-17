// A call of an arrow-function field of a class is a guarded direct call in a function without loops too, so it is inlined and the argument's type reaches JSON.stringify.
// IR= 1 respond IsClosureOf v[0-9]+ f[0-9]+
// IR= 1 respond frame 1 .*JSON.stringify
// IR= 1 respond Call v[0-9]+, v[0-9]+ \(v[0-9]+\)
interface Item {
  id: number;
  title: string;
}

class Context {
  status = 200;
  json = <T>(value: T, status?: number): string => {
    if (status) this.status = status;
    return JSON.stringify(value);
  };
}

function load(id: number): Item {
  return { id, title: "item " + id };
}

function respond(c: Context): string {
  return c.json(load(3));
}

console.log(respond(new Context()));
