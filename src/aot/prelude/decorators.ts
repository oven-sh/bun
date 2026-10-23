// Keep in sync with src/runtime.js (__legacyDecorateClassTS through __decorateElement). The functions of `context.access` are anonymous there, so they are assigned to members: an object literal would name them.

export function decorateClass(decorators: any, target: any): any {
  if (typeof Reflect === "object" && typeof (Reflect as any).decorate === "function") {
    return (Reflect as any).decorate(decorators, target, undefined, undefined);
  }
  let result = target;
  for (let i = decorators.length - 1; i >= 0; i--) {
    const decorator = decorators[i];
    if (decorator) result = decorator(result) || result;
  }
  return result;
}

function decorateMember(decorators: any, target: any, key: any, descriptor: any): any {
  let result = descriptor;
  if (typeof Reflect === "object" && typeof (Reflect as any).decorate === "function") {
    result = (Reflect as any).decorate(decorators, target, key, descriptor);
  } else {
    for (let i = decorators.length - 1; i >= 0; i--) {
      const decorator = decorators[i];
      if (decorator) result = decorator(target, key, result) || result;
    }
  }
  if (result) Object.defineProperty(target, key, result);
  return result;
}

export function decorateMethod(decorators: any, target: any, key: any): any {
  return decorateMember(decorators, target, key, Object.getOwnPropertyDescriptor(target, key));
}

export function decorateProperty(decorators: any, target: any, key: any): any {
  return decorateMember(decorators, target, key, undefined);
}

export function decorateParameter(index: number, decorator: any): any {
  return (target: any, key: any) => decorator(target, key, index);
}

export function defineMetadata(key: any, value: any): any {
  if (typeof Reflect === "object" && typeof (Reflect as any).metadata === "function")
    return (Reflect as any).metadata(key, value);
}

function metadataSymbol(): any {
  return (Symbol as any).metadata || Symbol.for("Symbol.metadata");
}

function throwTypeError(message: string): any {
  throw TypeError(message);
}

function defineNormalProperty(object: any, key: any, value: any): any {
  return key in object
    ? Object.defineProperty(object, key, { enumerable: true, configurable: true, writable: true, value })
    : (object[key] = value);
}

function setFunctionName(target: any, name: any): any {
  Object.defineProperty(target, "name", { value: name, enumerable: false, configurable: true });
  return target;
}

function expectFunction(value: any): any {
  return value !== undefined && typeof value !== "function" ? throwTypeError("Function expected") : value;
}

export function createDecoratorMetadata(base: any): any {
  return Object.create(base?.[metadataSymbol()] ?? null);
}

export function setDecoratorMetadata(target: any, metadata: any): any {
  return defineNormalProperty(target, metadataSymbol(), metadata);
}

export function createElement(kind: any, name: any, isStatic: any, isPrivate: any): any {
  return { kind, name, isStatic, isPrivate };
}

export function createPrivateStorage(test: any, get: any, set: any): any {
  return { test, get, set };
}

function createClassContext(name: any, done: any, metadata: any, initializers: any): any {
  return {
    kind: "class",
    name,
    metadata,
    addInitializer: (initializer: any) =>
      done._ ? throwTypeError("Already initialized") : initializers.push(expectFunction(initializer || null)),
  };
}

function createContext(element: any, done: any, metadata: any, initializers: any, access: any): any {
  const context = createClassContext(element.name, done, metadata, initializers);
  context.kind = element.kind;
  context.static = element.isStatic;
  context.private = element.isPrivate;
  context.access = access;
  return context;
}

function requirePrivateState(test: any, object: any, action: string): any {
  return (Object(object) === object && test.call(object)) || throwTypeError("Cannot " + action);
}

function testPrivateState(test: any, object: any): any {
  return Object(object) !== object ? throwTypeError('Cannot use the "in" operator on this value') : test.call(object);
}

function createPublicAccess(name: any): any {
  const access: any = {};
  access.has = (object: any) => name in object;
  access.get = (object: any) => object[name];
  access.set = (object: any, value: any) => (object[name] = value);
  return access;
}

function createPrivateAccess(test: any, accessors: any): any {
  const access: any = {};
  access.has = (object: any) => testPrivateState(test, object);
  access.get = (object: any) => (
    requirePrivateState(test, object, "read from private field"),
    accessors.get.call(object)
  );
  access.set = (object: any, value: any) => (
    requirePrivateState(test, object, "write to private field"),
    accessors.set.call(object, value),
    value
  );
  return access;
}

function takeAccessorResult(result: any, descriptor: any, valueInitializers: any): void {
  if (result === undefined) return;
  if (typeof result !== "object" || result === null) throwTypeError("Object expected");
  let part;
  expectFunction((part = result.get)) && (descriptor.get = part);
  expectFunction((part = result.set)) && (descriptor.set = part);
  expectFunction((part = result.init)) && valueInitializers.unshift(part);
}

export function applyClassDecorators(decorators: any, target: any, name: any, metadata: any, initializers: any): any {
  setFunctionName(target, name);
  for (let i = decorators.length - 1; i >= 0; i--) {
    const done: any = {};
    const result = (0, decorators[i])(target, createClassContext(name, done, metadata, initializers));
    done._ = 1;
    expectFunction(result) && (target = result);
  }
  setDecoratorMetadata(target, metadata);
  return target;
}

export function applyMethodDecorators(
  decorators: any,
  holder: any,
  element: any,
  metadata: any,
  initializers: any,
): void {
  const kind = element.kind,
    name = element.name;
  const key = kind === "method" ? "value" : kind === "getter" ? "get" : "set";
  const descriptor: any = Object.getOwnPropertyDescriptor(holder, name);
  for (let i = decorators.length - 1; i >= 0; i--) {
    const done: any = {};
    const access: any = {};
    access.has = (object: any) => name in object;
    if (kind === "setter") access.set = (object: any, value: any) => (object[name] = value);
    else access.get = (object: any) => object[name];
    const result = (0, decorators[i])(descriptor[key], createContext(element, done, metadata, initializers, access));
    done._ = 1;
    expectFunction(result) && (descriptor[key] = result);
  }
  Object.defineProperty(holder, name, descriptor);
}

export function applyPrivateMethodDecorators(
  decorators: any,
  value: any,
  element: any,
  test: any,
  metadata: any,
  initializers: any,
): any {
  const kind = element.kind;
  setFunctionName(value, (kind === "setter" ? "set " : kind === "getter" ? "get " : "") + element.name);
  for (let i = decorators.length - 1; i >= 0; i--) {
    const done: any = {};
    const access: any = {};
    access.has = (object: any) => testPrivateState(test, object);
    if (kind === "method")
      access.get = (object: any) => (requirePrivateState(test, object, "access private method"), value);
    if (kind === "getter")
      access.get = (object: any) => (requirePrivateState(test, object, "read from private field"), value.call(object));
    if (kind === "setter")
      access.set = (object: any, next: any) => (
        requirePrivateState(test, object, "write to private field"),
        value.call(object, next),
        next
      );
    const result = (0, decorators[i])(value, createContext(element, done, metadata, initializers, access));
    done._ = 1;
    expectFunction(result) && (value = result);
  }
  return value;
}

export function applyFieldDecorators(
  decorators: any,
  element: any,
  metadata: any,
  valueInitializers: any,
  extraInitializers: any,
): void {
  const name = element.name;
  for (let i = decorators.length - 1; i >= 0; i--) {
    const done: any = {};
    const access = createPublicAccess(name);
    const result = (0, decorators[i])(undefined, createContext(element, done, metadata, extraInitializers, access));
    done._ = 1;
    expectFunction(result) && valueInitializers.unshift(result);
  }
}

export function applyPrivateFieldDecorators(
  decorators: any,
  element: any,
  storage: any,
  metadata: any,
  valueInitializers: any,
  extraInitializers: any,
): void {
  for (let i = decorators.length - 1; i >= 0; i--) {
    const done: any = {};
    const access = createPrivateAccess(storage.test, storage);
    const result = (0, decorators[i])(undefined, createContext(element, done, metadata, extraInitializers, access));
    done._ = 1;
    expectFunction(result) && valueInitializers.unshift(result);
  }
}

export function applyAccessorDecorators(
  decorators: any,
  holder: any,
  element: any,
  metadata: any,
  valueInitializers: any,
  extraInitializers: any,
): void {
  const name = element.name;
  const own: any = Object.getOwnPropertyDescriptor(holder, name);
  const descriptor: any = { get: own.get, set: own.set, enumerable: true, configurable: true };
  for (let i = decorators.length - 1; i >= 0; i--) {
    const done: any = {};
    const context = createContext(element, done, metadata, extraInitializers, createPublicAccess(name));
    const result = (0, decorators[i])({ get: descriptor.get, set: descriptor.set }, context);
    done._ = 1;
    takeAccessorResult(result, descriptor, valueInitializers);
  }
  Object.defineProperty(holder, name, descriptor);
}

export function applyPrivateAccessorDecorators(
  decorators: any,
  element: any,
  storage: any,
  metadata: any,
  valueInitializers: any,
  extraInitializers: any,
): any {
  const descriptor: any = { get: storage.get, set: storage.set };
  for (let i = decorators.length - 1; i >= 0; i--) {
    const done: any = {};
    const context = createContext(
      element,
      done,
      metadata,
      extraInitializers,
      createPrivateAccess(storage.test, descriptor),
    );
    const result = (0, decorators[i])({ get: descriptor.get, set: descriptor.set }, context);
    done._ = 1;
    takeAccessorResult(result, descriptor, valueInitializers);
  }
  return descriptor;
}

export function runInitializers(initializers: any, receiver: any): void {
  for (let i = 0, count = initializers.length; i < count; i++) initializers[i].call(receiver);
}

export function runValueInitializers(initializers: any, receiver: any, value: any): any {
  for (let i = 0, count = initializers.length; i < count; i++) value = initializers[i].call(receiver, value);
  return value;
}
