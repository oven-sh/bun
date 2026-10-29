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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="Buffer" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Buffer) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="from"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(BufferFrom) flags=[IsExpected]}
// CHECK-NEXT: v7 = NewClosure v1 function=[[f_3]]
// CHECK-NEXT: v8 = NewObject layout=[[L_4]]
// CHECK-NEXT: PropDefine v8, v7 key=@@toPrimitive
// CHECK-NEXT: v10 = FinishObject v8
// CHECK-NEXT: v11 = Call v6, v4, v10 calleeKey="from" calleeName="Buffer.from"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Buffer flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v1 key="value"
// CHECK-NEXT: v14 = Convert v13 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v15 = ToString v14
// CHECK-NEXT: v16 = String string=" "
// CHECK-NEXT: v17 = ToString v12
// CHECK-NEXT: v18 = Strcat v15, v16, v17
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="width"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_5]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="Bun" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Bun) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="stringWidth"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(BunStringWidth) flags=[IsExpected]}
// CHECK-NEXT: v7 = NewClosure v1 function=[[f_6]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: v9 = NewObject layout=[[L_8]]
// CHECK-NEXT: PropDefine v9, v8 key="toString"
// CHECK-NEXT: v11 = FinishObject v9
// CHECK-NEXT: v12 = NewObject layout=[[L_9]]
// CHECK-NEXT: v13 = NewClosure v1 function=[[f_10]]
// CHECK-NEXT: DefineGetter v12, v13 key="countAnsiEscapeCodes"
// CHECK-NEXT: v15 = NewClosure v1 function=[[f_11]]
// CHECK-NEXT: DefineGetter v12, v15 key="ambiguousIsNarrow"
// CHECK-NEXT: v17 = FinishObject v12
// CHECK-NEXT: v18 = Call v6, v4, v11, v17 calleeKey="stringWidth" calleeName="Bun.stringWidth"
// CHECK-NEXT: v19 = Convert v18 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v1 key="value"
// CHECK-NEXT: v21 = Convert v20 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v22 = ToString v21
// CHECK-NEXT: v23 = String string=" "
// CHECK-NEXT: v24 = ToString v19
// CHECK-NEXT: v25 = Strcat v22, v23, v24
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="has"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string|symbol flags=[IsExpected]}] results=[{type=false flags=[IsExpected]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string|symbol):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="proxied"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_14]] flags=[IsExpected]}
// CHECK-NEXT: v6 = String string="has "
// CHECK-NEXT: v7 = Builtin builtin=String
// CHECK-NEXT: v8 = Call v7, -, v1 calleeName="String"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v10 = Add v6, v9
// CHECK-NEXT: v11 = Call v5, v3, v10 calleeKey="push" calleeName="proxied.push"
// CHECK-NEXT: v12 = Boolean
// CHECK-NEXT: v13 = Convert v12 declared={type=false flags=[IsExpected]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ambiguousIsNarrow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] captures=[{type=undefined|null|[[L_2]] flags=[IsExpected]}] thisType={type=anything} results=[{type=boolean flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="value"
// CHECK-NEXT: v2 = Increment v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v0, v3 key="value"
// CHECK-NEXT: v5 = Boolean boolean=true
// CHECK-NEXT: v6 = Convert v5 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
