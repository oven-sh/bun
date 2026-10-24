// Natives of Bun that are handed an object read its members, convert them and call them. Each function reads a local object behind the call.
import { getEventListeners } from "node:events";
import { isDeepStrictEqual } from "node:util";
const log = [];
function strategy(label, holder) {
  return {
    get highWaterMark() {
      holder.value++;
      log.push(label + ".highWaterMark");
      return {
        [Symbol.toPrimitive]() {
          holder.value++;
          log.push(label + ".highWaterMark converted");
          return 2;
        },
      };
    },
    get size() {
      holder.value++;
      log.push(label + ".size");
      return undefined;
    },
  };
}
function thenable(label, holder) {
  return {
    get then() {
      holder.value++;
      log.push(label + " then read");
      return function (resolve) {
        holder.value++;
        log.push(label + " then called");
        resolve();
      };
    },
  };
}
function readable() {
  const holder = { value: 0 };
  new ReadableStream(
    {
      get type() {
        holder.value++;
        log.push("readable.type");
        return undefined;
      },
      get autoAllocateChunkSize() {
        holder.value++;
        log.push("readable.autoAllocateChunkSize");
        return undefined;
      },
      start() {
        holder.value++;
        return thenable("readable.start", holder);
      },
    },
    strategy("readable", holder),
  );
  return holder.value;
}
function writable() {
  const holder = { value: 0 };
  new WritableStream(
    {
      get abort() {
        holder.value++;
        log.push("writable.abort");
        return undefined;
      },
      start() {
        holder.value++;
        return thenable("writable.start", holder);
      },
    },
    strategy("writable", holder),
  );
  return holder.value;
}
function transform() {
  const holder = { value: 0 };
  new TransformStream(
    {
      get cancel() {
        holder.value++;
        log.push("transform.cancel");
        return undefined;
      },
      start() {
        holder.value++;
        return thenable("transform.start", holder);
      },
    },
    strategy("transform.writable", holder),
    strategy("transform.readable", holder),
  );
  return holder.value;
}
console.log(readable(), writable(), transform());
await new Promise(resolve => setTimeout(resolve, 5));
console.log(log.join("\n"));

function start() {
  const holder = { value: 0 };
  const names = [];
  const sink = new Bun.ArrayBufferSink();
  sink.start({
    get asUint8Array() {
      holder.value++;
      names.push("asUint8Array");
      return true;
    },
    get highWaterMark() {
      holder.value++;
      names.push("highWaterMark");
      return 16;
    },
    get stream() {
      holder.value++;
      names.push("stream");
      return false;
    },
  });
  sink.write("abc");
  const bytes = sink.end();
  return `${holder.value} ${names} ${bytes.constructor.name} ${bytes.length}`;
}
console.log(start());
const proxied = [];
new Bun.ArrayBufferSink().start(
  new Proxy(
    {},
    {
      get(target, key) {
        proxied.push("get " + String(key));
      },
      getOwnPropertyDescriptor(target, key) {
        proxied.push("describe " + String(key));
      },
      has(target, key) {
        proxied.push("has " + String(key));
        return false;
      },
    },
  ),
);
console.log(proxied.join(","));

function fromValueOf() {
  const holder = { value: 0 };
  const bytes = Buffer.from({
    valueOf() {
      holder.value++;
      return "abc";
    },
  });
  return `${holder.value} ${bytes}`;
}
function fromToPrimitive() {
  const holder = { value: 0 };
  const bytes = Buffer.from({
    [Symbol.toPrimitive](hint) {
      holder.value++;
      return "hint " + hint;
    },
  });
  return `${holder.value} ${bytes}`;
}
function fromGetter() {
  const holder = { value: 0 };
  let message = "";
  try {
    Buffer.from({
      get valueOf() {
        holder.value++;
        return undefined;
      },
      get length() {
        holder.value++;
        return undefined;
      },
      get type() {
        holder.value++;
        return undefined;
      },
    });
  } catch (error) {
    message = error.code;
  }
  return `${holder.value} ${message}`;
}
console.log(fromValueOf(), "|", fromToPrimitive(), "|", fromGetter());

function width() {
  const holder = { value: 0 };
  const answer = Bun.stringWidth(
    {
      toString() {
        holder.value++;
        return "abc";
      },
    },
    {
      get countAnsiEscapeCodes() {
        holder.value++;
        return false;
      },
      get ambiguousIsNarrow() {
        holder.value++;
        return true;
      },
    },
  );
  return `${holder.value} ${answer}`;
}
function equal() {
  const holder = { value: 0 };
  const make = () => ({
    get [Symbol.toStringTag]() {
      holder.value++;
      return "Tag";
    },
    get member() {
      holder.value++;
      return 1;
    },
  });
  const answer = isDeepStrictEqual(make(), make());
  return `${holder.value > 0} ${answer}`;
}
function listeners() {
  const holder = { value: 0 };
  const target = new EventTarget();
  target.addEventListener("ping", () => {});
  const found = getEventListeners(target, {
    toString() {
      holder.value++;
      return "ping";
    },
  });
  return `${holder.value} ${found.length}`;
}
console.log(width(), "|", equal(), "|", listeners());

function make() {
  const holder = { value: 0 };
  const first = new Event("a", { bubbles: true, cancelable: true });
  const second = new Event("b", first);
  const third = new Event("c", {
    get bubbles() {
      holder.value++;
      return {
        valueOf() {
          holder.value += 10;
          return 0;
        },
      };
    },
    get composed() {
      holder.value++;
      return 0;
    },
  });
  return `${second.bubbles} ${second.cancelable} ${second.composed} ${third.bubbles} ${third.composed} ${holder.value}`;
}
console.log(make());
