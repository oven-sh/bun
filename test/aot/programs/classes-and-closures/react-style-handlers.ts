// React-style classes that keep their handlers as arrow functions in fields: a handler sees the object it was created for and every field of it, and a handler that runs while the constructor is still at work sees the fields that come later as undefined.
type Handler = () => unknown;
const show = (label: string, ...values: unknown[]) => console.log(label, values.map(value => (typeof value === "function" ? "function" : String(value))).join(" | "));

class Component<Props> {
  props: Props;
  constructor(props: Props) {
    this.props = props;
  }
}

// The handler is only stored while the object is constructed.
class Counter extends Component<{ step: number }> {
  state = { count: 0 };
  handleClick = () => {
    this.state = { count: this.state.count + this.props.step };
    return this.label + " " + this.state.count;
  };
  label = "counter";
  limit = this.props.step * 10;
  handleReset = () => {
    this.state = { count: 0 };
    return this.limit;
  };
}
const counter = new Counter({ step: 2 });
show("only stored", counter.handleClick(), counter.handleClick(), counter.limit, Object.keys(counter).join());
const { handleClick, handleReset } = counter;
show("detached", handleClick(), counter.state.count, handleReset(), counter.state.count, handleClick.call(null));
const other = new Counter({ step: 5 });
show("apart", other.handleClick(), counter.state.count, other.handleClick !== counter.handleClick, other.handleClick === other.handleClick, other.handleClick.name);

// The constructor hands the handler to code that calls it at once.
const subscribers: Handler[] = [];
function subscribe(handler: Handler) {
  subscribers.push(handler);
  return handler();
}
class Subscribed {
  name = "subscribed";
  onEvent = () => this.name + " " + this.ready;
  declare first: unknown;
  declare ready: boolean;
  constructor() {
    this.first = subscribe(this.onEvent);
    this.ready = true;
  }
}
const subscribed = new Subscribed();
show("passed on", subscribed.first, subscribed.onEvent(), subscribers[0](), Object.keys(subscribed).join());

// The constructor calls the handler before it stores a field that the handler reads.
class CalledEarly {
  base = 10;
  total = () => this.base + this.extra;
  declare early: unknown;
  declare extra: number;
  constructor() {
    this.early = this.total();
    this.extra = 5;
  }
}
const calledEarly = new CalledEarly();
show("called early", calledEarly.early, calledEarly.total(), Object.keys(calledEarly).join());

// The handler goes into another object, through which it is called during the construction.
const registry: { handler: Handler } = { handler: () => "empty" };
function callRegistered() {
  return registry.handler();
}
class Registered {
  id = 7;
  declare seen: unknown;
  declare tag: string;
  constructor() {
    registry.handler = () => this.id + ":" + this.tag;
    this.seen = callRegistered();
    this.tag = "tagged";
  }
}
const registered = new Registered();
show("stored elsewhere", registered.seen, callRegistered(), Object.keys(registered).join());

// The constructor of the base class calls a method of the subclass, which reads the fields before they exist.
class Widget {
  description: unknown;
  constructor() {
    this.description = this.describe();
  }
  describe(): unknown {
    return "widget";
  }
}
class Button extends Widget {
  text = "ok";
  onPress = () => this.text + "!";
  size = 3;
  describe() {
    return typeof this.onPress + " " + this.text + " " + this.size;
  }
}
const button = new Button();
show("read by the base constructor", button.description, button.describe(), button.onPress(), new Widget().description, Object.keys(button).join());

// A method that the constructor calls takes the handler out of its field.
class WithSetup {
  onReady = () => this.status;
  declare atSetup: unknown;
  declare status: string;
  constructor() {
    this.setup();
    this.status = "ready";
  }
  setup() {
    this.atSetup = this.onReady();
  }
}
const withSetup = new WithSetup();
show("read by a method", withSetup.atSetup, withSetup.onReady());

// The field of the base class is read by the constructor of the subclass.
class Handlers {
  declare target: string;
  onClick = () => this.target;
}
class Link extends Handlers {
  declare before: unknown;
  constructor() {
    super();
    this.before = this.onClick();
    this.target = "home";
  }
}
class QuietLink extends Handlers {
  constructor() {
    super();
    this.target = "quiet";
  }
}
const link = new Link();
show("inherited", link.before, link.onClick(), new QuietLink().onClick(), new Handlers().onClick());

// A setter takes the handler and calls it.
class Watched {
  results: unknown[] = [];
  declare late: string;
  set handler(value: Handler) {
    this.results.push(value());
  }
  constructor() {
    this.handler = () => this.late;
    this.late = "late";
    this.handler = () => this.late;
  }
}
show("taken by a setter", new Watched().results.join(), Object.keys(new Watched()).join());

// The object holds itself, and private fields hold handlers.
class Ring {
  self = this;
  next = () => this.self.value;
  value = 3;
}
class Timer {
  #ticks = 0;
  #onTick = () => ++this.#ticks + this.#offset;
  #offset = 100;
  tick() {
    return this.#onTick();
  }
}
const ring = new Ring(), timer = new Timer();
show("self", ring.next(), ring.self === ring, ring.self.self.next(), timer.tick(), timer.tick());

// Many objects, so that the constructors and the handlers get whatever form hot code gets.
let sum = 0;
const sampled: Counter[] = [];
for (let i = 0; i < 20000; i++) {
  const each = new Counter({ step: i & 3 });
  each.handleClick();
  each.handleClick();
  sum += each.state.count + each.limit + new CalledEarly().total() + String(new Subscribed().first).length + String(new Button().description).length;
  if (i % 1001 === 0) sampled.push(each);
}
show("many", sum, sampled.map(each => each.handleClick()).join(), subscribers.length, subscribers[20000]());
