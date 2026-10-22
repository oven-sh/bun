interface State {
  prefix: string;
  next: number;
}
interface Task {
  request: Request;
  name: string;
}
interface Request {
  state: State;
  status: number;
  tasks: Task[];
}
interface RequestConstructor {
  new (state: State): Request;
  (this: Request, state: State): void;
}

function RequestInstance(this: Request, state: State) {
  this.state = state;
  this.status = 10;
  this.tasks = [];
}

function createRequest(prefix: string): Request {
  const request = new (RequestInstance as RequestConstructor)({ prefix, next: 0 });
  request.tasks.push({ request, name: prefix + request.state.next++ });
  return request;
}

const made = createRequest("r");
console.log(made.status, made.state.prefix, made.state.next, made.tasks[0].name, made.tasks[0].request === made);
console.log(Object.getPrototypeOf(made) === RequestInstance.prototype, Object.keys(made).join());

interface Control {
  control: number;
}
const control: Control = JSON.parse('{"control":1}');
console.log(control.control);
