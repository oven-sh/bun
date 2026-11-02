// Built-ins of the engine on their slow roads: what they store, read and call there is memory and code of their operands. Each part reads an object of its own behind the call.
// RegExp.prototype.test on a RegExp that is not as it was created stores lastIndex.
{
  function lastIndexAfterTest(re, text) {
    re.lastIndex = 0;
    const found = re.test(text);
    return `${found} ${re.lastIndex}`;
  }
  class Derived extends RegExp {}
  const withProperty = /a/g;
  withProperty.extra = 1;
  const withPrototype = /a/g;
  Object.setPrototypeOf(withPrototype, Object.create(RegExp.prototype));
  const derived = new Derived("a", "g");
  const sticky = new Derived("a", "y");
  for (let round = 0; round < 3; round++) {
    console.log(lastIndexAfterTest(withProperty, "aa"));
    console.log(lastIndexAfterTest(withPrototype, "aa"));
    console.log(lastIndexAfterTest(derived, "aa"));
    console.log(lastIndexAfterTest(sticky, "ba"));
  }
  function onlyDerived(text) {
    const re = new Derived("a", "g");
    re.lastIndex = 0;
    re.test(text);
    const first = re.lastIndex;
    re.test(text);
    return first + " " + re.lastIndex;
  }
  console.log(onlyDerived("aaa"));
  function literalWithProperty(text) {
    const re = /a/g;
    re.extra = text;
    re.test(text);
    const first = re.lastIndex;
    re.test(text);
    return first + " " + re.lastIndex;
  }
  console.log(literalWithProperty("aaa"));
  function calledThroughPrototype(re, text) {
    re.lastIndex = 0;
    RegExp.prototype.test.call(re, text);
    return re.lastIndex;
  }
  console.log(
    calledThroughPrototype(derived, "aa"),
    calledThroughPrototype(withProperty, "aa"),
    calledThroughPrototype(/a/g, "aa"),
  );
}

// Array.prototype.push | unshift | splice on a typed array convert what they store: code of the argument runs.
{
  let state = 1;
  function pushOnto(target, item) {
    state = 1;
    let threw = "";
    try {
      Array.prototype.push.call(target, item);
    } catch (error) {
      threw = error.constructor.name;
    }
    return `${state} ${threw}`;
  }
  const item = {
    [Symbol.toPrimitive]() {
      state = 2;
      return 7;
    },
  };
  console.log(pushOnto(new Int8Array(2), item));
  console.log(pushOnto([], item));
  function local() {
    const holder = { value: 1 };
    const converting = {
      [Symbol.toPrimitive]() {
        holder.value = 2;
        return 7;
      },
    };
    const bytes = new Int8Array(2);
    try {
      Array.prototype.unshift.call(bytes, converting);
    } catch {}
    const afterUnshift = holder.value;
    holder.value = 1;
    try {
      Array.prototype.splice.call(bytes, 0, 1, converting);
    } catch {}
    return `${afterUnshift} ${holder.value}`;
  }
  console.log(local());
}

// Function.prototype.bind reads the prototype of its receiver: the trap of a proxy runs.
{
  let state = 1;
  function bindIt(callee) {
    state = 1;
    const bound = Function.prototype.bind.call(callee, null);
    return `${state} ${Object.getPrototypeOf(bound) === marker}`;
  }
  const marker = Object.create(Function.prototype);
  const proxy = new Proxy(function () {}, {
    getPrototypeOf() {
      state = 2;
      return marker;
    },
  });
  console.log(bindIt(proxy));
  console.log(bindIt(function () {}));
  function local() {
    const holder = { value: 1 };
    const asked = new Proxy(function () {}, {
      getPrototypeOf(target) {
        holder.value = 2;
        return Reflect.getPrototypeOf(target);
      },
    });
    asked.bind(null);
    return holder.value;
  }
  console.log(local());
}

{
  function create() {
    const kept = { tag: 1 };
    const made = Object.create(null, {
      member: { value: kept, enumerable: true },
      read: {
        get() {
          return kept;
        },
      },
    });
    kept.tag = 2;
    const seen = made.member.tag;
    made.member.tag = 3;
    return `${seen} ${kept.tag} ${made.read === kept} ${made.member === kept}`;
  }
  console.log(create());
}

// What Iterator.from answers for an object that is no Iterator calls next and return of that object.
{
  function wrap() {
    const holder = { value: 0 };
    const wrapped = Iterator.from({
      next() {
        holder.value++;
        return { done: holder.value > 2, value: holder };
      },
      get return() {
        holder.value += 10;
        return function () {
          holder.value += 100;
          return { done: true, value: "returned" };
        };
      },
    });
    const first = wrapped.next();
    const afterNext = holder.value;
    const isSame = first.value === holder;
    const last = wrapped.return();
    return `${afterNext} ${isSame} ${holder.value} ${last.value}`;
  }
  console.log(wrap());
}

// %TypedArray%.prototype.toLocaleString hands its operands to Number.prototype.toLocaleString, which reads them.
{
  function format() {
    const holder = { value: 0 };
    const names = [];
    const text = new Int8Array([1, 2]).toLocaleString(
      {
        get length() {
          holder.value++;
          names.push("length");
          return 1;
        },
        get 0() {
          holder.value++;
          names.push("0");
          return "en-US";
        },
      },
      {
        get localeMatcher() {
          holder.value++;
          names.push("localeMatcher");
          return undefined;
        },
        get minimumFractionDigits() {
          holder.value++;
          names.push("minimumFractionDigits");
          return 1;
        },
      },
    );
    return `${holder.value} ${text} ${names}`;
  }
  console.log(format());
}

// The getter `format` of Intl.DateTimeFormat.prototype and Intl.NumberFormat.prototype looks for its prototype object above a receiver that is no formatter: the trap of a proxy runs.
{
  const dateFormat = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, "format").get;
  const numberFormat = Object.getOwnPropertyDescriptor(Intl.NumberFormat.prototype, "format").get;
  function read(getter) {
    const holder = { value: 1 };
    const receiver = new Proxy(
      {},
      {
        getPrototypeOf() {
          holder.value = 2;
          return null;
        },
      },
    );
    let outcome = "returned";
    try {
      getter.call(receiver);
    } catch (error) {
      outcome = error.constructor.name;
    }
    return `${holder.value} ${outcome}`;
  }
  console.log(read(dateFormat), read(numberFormat));
  function readDirectly() {
    const holder = { value: 1 };
    const receiver = new Proxy(
      {},
      {
        getPrototypeOf() {
          holder.value = 2;
          return null;
        },
      },
    );
    let outcome = "returned";
    try {
      Reflect.get(Intl.DateTimeFormat.prototype, "format", receiver);
    } catch (error) {
      outcome = error.constructor.name;
    }
    return `${holder.value} ${outcome}`;
  }
  console.log(readDirectly());
  function inherited() {
    const holder = { value: 1 };
    const above = new Proxy(Intl.NumberFormat.prototype, {
      getPrototypeOf(target) {
        holder.value = 2;
        return Reflect.getPrototypeOf(target);
      },
    });
    const receiver = Object.create(above);
    let outcome = "returned";
    try {
      receiver.format;
    } catch (error) {
      outcome = error.constructor.name;
    }
    return `${holder.value} ${outcome}`;
  }
  console.log(inherited());
  function legacy() {
    const made = Intl.DateTimeFormat.call(Object.create(Intl.DateTimeFormat.prototype), "en-US", { timeZone: "UTC" });
    return `${typeof made.format} ${made.format(0)}`;
  }
  console.log(legacy());
}
