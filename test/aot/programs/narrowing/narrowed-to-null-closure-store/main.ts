// A variable, a property or an element that a nested function assigns: TypeScript narrows it to the null that was stored last and does not see the later store. The slot holds whatever its annotated type allows, and a use of it depends on its current value.
class Socket {
  open = true;
  end() {
    this.open = false;
    return "ended";
  }
}
class Pipe {
  end() {
    return "pipe ended";
  }
}
function later(f: () => void) {
  f();
}
function optionalCall() {
  let socket: Socket | null = null;
  later(() => {
    socket = new Socket();
  });
  // @ts-ignore
  return socket?.end();
}
function optionalRead() {
  let socket: Socket | null = null;
  later(() => {
    socket = new Socket();
  });
  // @ts-ignore
  return socket?.open;
}
function startsUndefined() {
  let socket: Socket | undefined = undefined;
  later(() => {
    socket = new Socket();
  });
  // @ts-ignore
  return socket?.end();
}
function literal() {
  let point: { x: number; y: number } | null = null;
  later(() => {
    point = { x: 1, y: 2 };
  });
  // @ts-ignore
  return [point?.x, point?.y];
}
function staysNull() {
  let socket: Socket | null = null;
  later(() => {});
  // @ts-ignore
  return socket?.end();
}
function inFinally() {
  let socket: Socket | null = null;
  try {
    later(() => {
      socket = new Socket();
    });
    return "tried";
  } finally {
    // @ts-ignore
    console.log("finally:", socket?.end());
  }
}
async function acrossAnAwait() {
  const { promise, resolve } = Promise.withResolvers<string>();
  let socket: Socket | null = null;
  setTimeout(() => {
    socket = new Socket();
    resolve("connected");
  }, 0);
  const said = await promise;
  // @ts-ignore
  return [said, socket?.end()];
}
function oneOfTwo() {
  let either: Socket | Pipe | null = null;
  later(() => {
    either = new Pipe();
  });
  // @ts-ignore
  return either?.end();
}
function withoutTheQuestionMark() {
  let socket: Socket | null = null;
  later(() => {
    socket = new Socket();
  });
  // @ts-ignore
  return socket.end();
}
function nullWithoutTheQuestionMark() {
  let socket: Socket | null = null;
  later(() => {});
  try {
    // @ts-ignore
    return socket.end();
  } catch (e) {
    return (e as Error).constructor.name;
  }
}
class Holder {
  socket: Socket | null = null;
}
function propertyOfAnInstance() {
  const holder = new Holder();
  holder.socket = null;
  later(() => {
    holder.socket = new Socket();
  });
  // @ts-ignore
  return holder.socket?.end();
}
function propertyOfALiteral() {
  const holder: { socket: Socket | null } = { socket: null };
  holder.socket = null;
  later(() => {
    holder.socket = new Socket();
  });
  // @ts-ignore
  return holder.socket?.end();
}
function element() {
  const list: (Socket | null)[] = [null];
  list[0] = null;
  later(() => {
    list[0] = new Socket();
  });
  // @ts-ignore
  return list[0]?.end();
}
for (const f of [optionalCall, optionalRead, startsUndefined, literal, staysNull, inFinally, oneOfTwo, withoutTheQuestionMark, nullWithoutTheQuestionMark, propertyOfAnInstance, propertyOfALiteral, element]) console.log(f.name + ":", JSON.stringify(f()));
console.log("acrossAnAwait:", JSON.stringify(await acrossAnAwait()));
