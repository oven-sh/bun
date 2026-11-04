// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: fromToPrimitive width has ambiguousIsNarrow
// CHECK-LABEL: function {{*}}name="fromToPrimitive"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="Buffer" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Buffer) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="from"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(BufferFrom) flags=[IsExpected]}
// CHECK-NEXT: v6 = NewClosure v0 function=[[f_2]]
// CHECK-NEXT: v7 = NewObject layout=[[L_3]]
// CHECK-NEXT: PropDefine v7, v6 key=@@toPrimitive
// CHECK-NEXT: v9 = FinishObject v7
// CHECK-NEXT: v10 = Call v5, v3, v9 calleeKey="from" calleeName="Buffer.from"
// CHECK-NEXT: v11 = PropGet v0 key="value"
// CHECK-NEXT: v12 = ToString v11
// CHECK-NEXT: v13 = String string=" "
// CHECK-NEXT: v14 = ToString v10
// CHECK-NEXT: v15 = Strcat v12, v13, v14
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="width"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Data data=[[d_4]]
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="Bun" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Bun) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="stringWidth"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(BunStringWidth) flags=[IsExpected]}
// CHECK-NEXT: v6 = NewClosure v0 function=[[f_5]]
// CHECK-NEXT: v7 = NewObject -, v6 layout=[[L_6]] fields=[0]
// CHECK-NEXT: v8 = FinishObject v7
// CHECK-NEXT: v9 = NewObject layout=[[L_7]]
// CHECK-NEXT: v10 = NewClosure v0 function=[[f_8]]
// CHECK-NEXT: DefineGetter v9, v10 key="countAnsiEscapeCodes"
// CHECK-NEXT: v12 = NewClosure v0 function=[[f_9]]
// CHECK-NEXT: DefineGetter v9, v12 key="ambiguousIsNarrow"
// CHECK-NEXT: v14 = FinishObject v9
// CHECK-NEXT: v15 = Call v5, v3, v8, v14 calleeKey="stringWidth" calleeName="Bun.stringWidth"
// CHECK-NEXT: v16 = PropGet v0 key="value"
// CHECK-NEXT: v17 = ToString v16
// CHECK-NEXT: v18 = String string=" "
// CHECK-NEXT: v19 = ToString v15
// CHECK-NEXT: v20 = Strcat v17, v18, v19
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="has"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string|symbol flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string|symbol):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="proxied"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = String string="has "
// CHECK-NEXT: v6 = Builtin builtin=String
// CHECK-NEXT: v7 = Call v6, -, v1 calleeName="String"
// CHECK-NEXT: v8 = Add v5, v7
// CHECK-NEXT: v9 = Call v4, v3, v8 calleeKey="push" calleeName="proxied.push"
// CHECK-NEXT: v10 = Boolean
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ambiguousIsNarrow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] captures=[{type=anything variableName="holder"}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = PropGet v0 key="value"
// CHECK-NEXT: v2 = Increment v1
// CHECK-NEXT: PropSet v0, v2 key="value"
// CHECK-NEXT: v4 = Boolean boolean=true
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
