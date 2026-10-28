import { isObject, type OperandName } from "./table-description";

// Where in an operand a value sits. Iterator and IteratorResult are what the iteration protocol makes from an iterable operand.
export type ContentKind =
  | "Element"
  | "Key"
  | "Value"
  | "Property"
  | "Getter"
  | "Setter"
  | "Iterated"
  | "Iterator"
  | "IteratorResult"
  | "State"
  | "Thrown";
export type Origin =
  | { kind: "Operand"; operand: OperandName }
  | { kind: "Content"; operand: OperandName; content: ContentKind; key: PropertyKey | undefined; depth: number }
  | { kind: "CallbackResult"; operand: OperandName; callee: Origin; call: number };
export type Trap =
  | "get"
  | "has"
  | "ownKeys"
  | "getOwnPropertyDescriptor"
  | "getPrototypeOf"
  | "isExtensible"
  | "set"
  | "defineProperty"
  | "deleteProperty"
  | "setPrototypeOf"
  | "preventExtensions"
  | "apply"
  | "construct";
export type LogEvent = {
  subject: object;
  origin: Origin;
  trap: Trap;
  key: PropertyKey | undefined;
  isOwnKey: boolean;
  thisValue: unknown;
  passedValues: unknown[];
  descriptor: PropertyDescriptor | undefined;
  // What a called function gave back, once it has.
  outcome: { returned: unknown } | { thrown: unknown } | undefined;
  isLate: boolean;
  // The harness stepped the result: what runs is `next` of the result, which has an entry of its own.
  isDuringStep: boolean;
};

const descriptorValueKeys = ["value", "get", "set"] as const;

export class Log {
  readonly events: LogEvent[] = [];
  readonly tracked: object[] = [];
  isRecording = false;
  isLate = false;
  isStepping = false;
  #holders = new WeakMap<object, object>();
  #origins = new WeakMap<object, Origin>();
  #targets = new WeakMap<object, object>();

  track<T extends object>(target: T, origin: Origin): T {
    const record = (trap: Trap, key: PropertyKey | undefined, details: Partial<LogEvent> = {}) => {
      if (!this.isRecording) return undefined;
      const event: LogEvent = {
        subject: proxy,
        origin,
        trap,
        key,
        isOwnKey: key !== undefined && Object.hasOwn(target, key),
        thisValue: undefined,
        passedValues: [],
        descriptor: undefined,
        outcome: undefined,
        isLate: this.isLate,
        isDuringStep: this.isStepping,
        ...details,
      };
      this.events.push(event);
      return event;
    };
    const runUserCode = <R>(event: LogEvent | undefined, forward: () => R): R => {
      const wasRecording = this.isRecording;
      this.isRecording = false;
      try {
        const returned = forward();
        if (event) event.outcome = { returned };
        return returned;
      } catch (thrown) {
        if (event) event.outcome = { thrown };
        throw thrown;
      } finally {
        this.isRecording = wasRecording;
      }
    };
    const members = new Map<PropertyKey, Function>();
    const proxy: T = new Proxy<any>(target, {
      get: (target, key, receiver) => {
        record("get", key);
        // A getter of the engine that is found here has an entry of its own.
        const value = runUserCode(undefined, () => Reflect.get(target, key, receiver));
        return typeof value === "function" ? this.#asMember(members, value, proxy, origin, key) : value;
      },
      has(target, key) {
        record("has", key);
        return Reflect.has(target, key);
      },
      ownKeys(target) {
        record("ownKeys", undefined);
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, key) {
        record("getOwnPropertyDescriptor", key);
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      getPrototypeOf(target) {
        record("getPrototypeOf", undefined);
        return Reflect.getPrototypeOf(target);
      },
      isExtensible(target) {
        record("isExtensible", undefined);
        return Reflect.isExtensible(target);
      },
      set(target, key, value, receiver) {
        record("set", key, { passedValues: [value] });
        return Reflect.set(target, key, value, receiver === proxy ? target : receiver);
      },
      defineProperty(target, key, descriptor) {
        const present = descriptorValueKeys.filter(name => Object.hasOwn(descriptor, name));
        record("defineProperty", key, { passedValues: present.map(name => descriptor[name]), descriptor });
        return Reflect.defineProperty(target, key, descriptor);
      },
      deleteProperty(target, key) {
        record("deleteProperty", key);
        return Reflect.deleteProperty(target, key);
      },
      setPrototypeOf(target, prototype) {
        record("setPrototypeOf", undefined, { passedValues: [prototype] });
        return Reflect.setPrototypeOf(target, prototype);
      },
      preventExtensions(target) {
        record("preventExtensions", undefined);
        return Reflect.preventExtensions(target);
      },
      apply(target, thisValue, args) {
        const event = record("apply", undefined, { thisValue, passedValues: args });
        return runUserCode(event, () => Reflect.apply(target, thisValue, args));
      },
      construct(target, args, newTarget) {
        const thisValue = newTarget === proxy ? undefined : newTarget;
        const event = record("construct", undefined, { thisValue, passedValues: args });
        return runUserCode(event, () => Reflect.construct(target, args, newTarget === proxy ? target : newTarget));
      },
    });
    this.#targets.set(proxy, target);
    this.#origins.set(target, origin);
    this.identify(proxy, origin);
    return proxy;
  }

  // A method of the engine that is found through a tracked object counts as code of the operand: what it does in turn is declared
  // by its own entry.
  #asMember(
    members: Map<PropertyKey, Function>,
    method: Function,
    holderObject: object,
    holder: Origin,
    key: PropertyKey,
  ): Function {
    if (this.#origins.has(method)) return method;
    const known = members.get(key);
    if (known && this.#targets.get(known) === method) return known;
    const depth = holder.kind === "Content" ? holder.depth + 1 : 1;
    const origin: Origin =
      holder.kind === "CallbackResult" ? holder : { kind: "Content", operand: holder.operand, content: "Property", key, depth };
    const member = this.track(method, origin);
    this.#origins.delete(method);
    this.#holders.set(member, holderObject);
    members.set(key, member);
    return member;
  }

  identify(value: object, origin: Origin): void {
    this.#origins.set(value, origin);
    this.tracked.push(value);
  }

  originOf(value: unknown): Origin | undefined {
    return isObject(value) ? this.#origins.get(value) : undefined;
  }

  // The tracked object through which a method of the engine was found.
  holderOf(member: object): object | undefined {
    return this.#holders.get(member);
  }

  targetOf<T>(value: T): T {
    return isObject(value) ? ((this.#targets.get(value) as T | undefined) ?? value) : value;
  }

  isProxy(value: unknown): boolean {
    return isObject(value) && this.#targets.has(value);
  }
}
