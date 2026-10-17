// A call of an arrow-function field of a class goes directly to the function. It must still see a replacement, from typed and from untyped code, and a subclass's own field.
interface Item {
  id: number;
  title: string;
}

class Context {
  status = 200;
  log: string[] = [];
  json = <T>(value: T, status?: number): string => {
    if (status) this.status = status;
    return JSON.stringify(value);
  };
  header = (name: string, value: string): void => {
    this.log.push(name + ": " + value);
  };
  constant = (): number => 7;
}

class Louder extends Context {
  override json = <T>(value: T): string => "LOUD " + JSON.stringify(value);
}

function respond(c: Context, item: Item): string {
  c.header("x-id", String(item.id));
  return c.json(item, 201) + " " + c.status + " " + c.log.join() + " " + c.constant();
}

function patch(target: any): void {
  target.json = (value: unknown) => "patched " + typeof value;
  target.constant = () => 8;
}

const item: Item = { id: 1, title: "one" };
console.log(respond(new Context(), item));
console.log(respond(new Louder(), item));

const patched = new Context();
patch(patched);
console.log(respond(patched, item));

const assigned = new Context();
assigned.header = (name) => {
  assigned.log.push("assigned " + name);
};
console.log(respond(assigned, item));

const read = new Context();
const json = read.json;
console.log(json(item), respond(read, item), json === read.json);

const borrowed = new Context();
borrowed.json = read.json;
console.log(respond(borrowed, item), read.status, borrowed.status);

try {
  respond(null as unknown as Context, item);
} catch (error) {
  console.log(error instanceof TypeError);
}
