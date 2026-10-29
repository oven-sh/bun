interface State {
  prefix: string;
  next: number;
}
interface Request {
  state: State;
  status: number;
}
interface RequestConstructor {
  new (state: State): Request;
  (this: Request, state: State): void;
}

function RequestInstance(this: Request, state: State) {
  this.state = state;
  this.status = 10;
}

function describe(request: Request): string {
  return request.status + " " + request.state.prefix + request.state.next;
}

const made = new (RequestInstance as RequestConstructor)({ prefix: "r", next: 1 });
console.log(describe(made));

const outside: any = globalThis;
outside.constructRequest = RequestInstance;
outside.describeRequest = describe;
const plain = JSON.parse('{"status":0,"state":{"next":0,"prefix":"q"},"extra":true}');
Reflect.apply(outside.constructRequest, plain, [JSON.parse('{"next":2,"prefix":"p"}')]);
console.log(Object.keys(plain).join(), outside.describeRequest(plain));
