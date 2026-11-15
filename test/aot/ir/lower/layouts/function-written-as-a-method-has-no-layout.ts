// A function that is written where it is stored into a prototype object, in the literal that becomes one, or as the `get` or `set` of a descriptor
// stores into the object it is called on, which a constructor has made. It has no layout of its own, so the type of its `this` does not admit one more layout for each method.
// RUN: link
// CHECK: layout {{*}}kind=Instance name="Message" {{*}}flags=[IsConstructorFunction]
// CHECK: layout {{*}}kind=Instance name="Reply" {{*}}flags=[IsConstructorFunction]
// CHECK: layout {{*}}kind=Instance name="Inner" {{*}}flags=[IsConstructorFunction]
// RUN(METHODS): link
// METHODS-NOT: layout {{*}}name="setHeader"
// METHODS-NOT: layout {{*}}name="end"
// METHODS-NOT: layout {{*}}name="reset"
// METHODS-NOT: layout {{*}}name="storeHeaders"
// METHODS-NOT: layout {{*}}name="readHeaders"
// METHODS-NOT: layout {{*}}name="readRawHeaders"
// METHODS-NOT: layout {{*}}name="storeRawHeaders"
// METHODS-NOT: layout {{*}}name="drain"
// METHODS-NOT: layout {{*}}name="start"
// METHODS-NOT: layout {{*}}name="remove"
// METHODS-NOT: layout {{*}}name="listen"

interface Message {
  headers: object | null;
  finished: boolean;
}

function Message(this: Message) {
  this.headers = null;
  this.finished = false;
}
Message.prototype.setHeader = function setHeader(this: Message) {
  this.headers = {};
};
(Message as any).prototype.end = function end(this: Message) {
  this.finished = true;
};
Object.defineProperty(Message.prototype, "_headers", {
  get: function readHeaders(this: Message) {
    this.finished = false;
    return this.headers;
  },
  set: function storeHeaders(this: Message, value: object) {
    this.headers = value;
  },
});

// Declared first, handed over under its name, and compared with what a lookup finds.
function readRawHeaders(this: Message) {
  this.finished = false;
  return this.headers;
}
function storeRawHeaders(this: Message, value: object) {
  this.headers = value;
}
Object.defineProperty(Message.prototype, "rawHeaders", { get: readRawHeaders, set: storeRawHeaders as (value: object) => void });
export const isUntouched =
  Object.getOwnPropertyDescriptor(Message.prototype, "rawHeaders")!.get === readRawHeaders &&
  storeRawHeaders != Object.getOwnPropertyDescriptor(Message.prototype, "_headers")!.set;

// A function that says what it is called on and becomes a member of any object is a method of such objects. A `typeof` in a type runs nothing.
function drain(this: Message) {
  this.finished = true;
}
function start(this: Message) {
  this.headers = {};
}
interface Handlers {
  drain: typeof drain;
  start?: typeof start;
}
export const handlers: Handlers = { drain };
handlers.start = start;
// The name of a constant stands for the function that it holds.
const remove = function remove(this: Message) {
  this.headers = null;
};
(Message.prototype as any).remove = remove;
(Message.prototype as any).off = remove;
const listen = function listen(this: any) {
  this.finished = false;
};
listen.call(handlers);

function Reply(this: Message) {
  this.headers = null;
  this.finished = true;
}
Reply.prototype = {
  reset: function reset(this: Message) {
    this.headers = null;
  },
};

// A function under any other name of a literal may be a constructor, where it does not say what it is called on.
const holder = {
  Inner: function Inner(this: any) {
    this.headers = null;
  },
};

export const instances = [new (Message as any)(), new (Reply as any)(), new (holder.Inner as any)()];
