// Custom elements.
const core = require("internal/desktop/dom/core");

const { ELEMENT, HTML, domError, expose, flags, hooks, kinds, rare, realm, setState, states, unwrap, wrap } = core;
const { CONNECTED, CUSTOM, FAILED_CUSTOM, HOST, UNDEFINED } = flags;

type N = $Dom.N;
type Doc = $Dom.Doc;
type Page = $Dom.Page;
declare global {
  namespace $Dom {
    type Definition = DefinitionImpl;
  }
}
type DefinitionImpl = Definition;
type Definition = {
  registry: Registry;
  name: string;
  localName: string;
  ctor: any;
  observed: Set<string>;
  callbacks: Record<string, any>;
  formAssociated: boolean;
  disabledFeatures: string[];
  /** The elements that are being upgraded. */
  stack: (N | null)[];
};

class Registry {
  js: object;
  /** Null for a scoped one. */
  doc: Doc | null = null;
  scopedDocs = new Set<Doc>();
  byName = new Map<string, Definition>();
  byConstructor = new Map<object, Definition>();
  waiting = new Map<string, PromiseWithResolvers<any>>();
  isDefining = false;

  constructor(js: object) {
    this.js = js;
  }
}

/** The definitions whose constructors are being called to make or upgrade an element. */
const active = new Map<object, Definition>();

function construct(definition: Definition): unknown {
  const { ctor } = definition;
  const [before, { page }, registry] = [active.$get(ctor), realm, core.setRegistry(undefined)];
  active.$set(ctor, definition);
  realm.page = realm.root;
  try {
    return new ctor();
  } finally {
    realm.page = page;
    core.setRegistry(registry);
    if (before === undefined) active.$delete(ctor);
    else active.$set(ctor, before);
  }
}

function lookUp(registry: any, localName: string, is: string | null): Definition | undefined {
  const byName = registry?.$impl.byName;
  const found = byName?.$get(localName) ?? (is === null ? undefined : byName?.$get(is));
  return found?.localName === localName ? found : undefined;
}

function becomeCustom(node: N, definition: Definition) {
  rare(node).definition = definition;
  node.flags = (node.flags & ~UNDEFINED) | CUSTOM;
  setState(node, states.UNDEFINED, false);
  if (definition.formAssociated) hooks.makeFormAssociated(node);
}

/** https://html.spec.whatwg.org/#html-element-constructors */
function prepareCustomElement(newTarget: any, called: Function): any {
  const { doc } = realm.page;
  const definition = active.$get(newTarget) ?? doc.registry.$impl.byConstructor.$get(newTarget);
  if (definition === undefined) core.illegalConstructor();
  const { stack, localName } = definition!;
  const wanted = (kinds.html.$get(localName) ?? kinds.htmlElement).load();
  if (called !== wanted || core.isInterface(newTarget)) core.illegalConstructor();
  let { prototype } = newTarget;
  if (!$isObject(prototype))
    prototype = (core.pageOfCallback(newTarget)?.mirror?.constructorFor(wanted) ?? wanted).prototype;
  let node = stack[stack.length - 1];
  if (stack.length === 0) {
    node = core.createPlainElement(doc, localName, HTML);
    if (definition!.name !== localName) rare(node).is = definition!.name;
    if (definition!.registry.doc === null) rare(node).registry = definition!.registry.js;
    becomeCustom(node, definition!);
  } else if (node === null) throw new TypeError("This instance is already constructed");
  else stack[stack.length - 1] = null;
  return Object.setPrototypeOf(wrap(node!), prototype);
}

function upgrade(node: N, definition: Definition) {
  if (!(node.flags & UNDEFINED) || node.flags & FAILED_CUSTOM) return;
  rare(node).definition = definition;
  node.flags |= FAILED_CUSTOM;
  const attrs: string[] = node.attrs ?? [];
  for (let i = 0; i < attrs.length; i += 2) {
    const name = core.attrLocalName(attrs[i]);
    if (!definition.observed.$has(name)) continue;
    core.queueReaction(node, "attributeChangedCallback", [name, null, attrs[i + 1], core.attrNamespace(attrs[i])]);
  }
  if (node.flags & CONNECTED) core.queueReaction(node, "connectedCallback", []);
  definition.stack.push(node);
  node.rare!.isPrecustomized = true;
  try {
    if (definition.disabledFeatures.includes("shadow") && node.flags & HOST) {
      throw domError("NotSupportedError", "The element already has a shadow root.");
    }
    if (construct(definition) !== node.js) throw new TypeError("Custom element constructors have to return this");
  } catch (error) {
    node.rare!.definition = null;
    node.rare!.reactions!.length = 0;
    throw error;
  } finally {
    node.rare!.isPrecustomized = false;
    definition.stack.pop();
  }
  node.flags &= ~FAILED_CUSTOM;
  becomeCustom(node, definition);
  if (definition.formAssociated) node.kind.moved!(node, null);
}

function tryUpgrade(node: N) {
  const definition = lookUp(core.registryOf(node), node.name, node.rare?.is ?? null);
  if (definition !== undefined) core.enqueueUpgrade(node, definition);
}

function createUndefined(doc: Doc, name: string, is: string | null): N {
  const node = core.createPlainElement(doc, name, HTML);
  node.flags |= UNDEFINED;
  node.state |= states.UNDEFINED;
  if (is !== null) rare(node).is = is;
  return node;
}

hooks.upgrade = upgrade;
hooks.tryUpgrade = tryUpgrade;
hooks.beforeConstructing = (parent: N, name: string, is: string | null) => {
  if (lookUp(core.registryOf(parent), name, is) !== undefined)
    require("internal/desktop/dom/events").microtaskCheckpoint();
};

hooks.createCustomElement = (
  doc: Doc,
  name: string,
  is: string | null,
  synchronous: boolean,
  registry: any,
  prefix: string | null,
) => {
  const definition = lookUp(registry, name, is);
  if (definition === undefined || !synchronous || definition.name !== name) {
    const node = createUndefined(doc, name, is);
    if (prefix !== null) rare(node).prefix = prefix;
    if (definition === undefined) return node;
    if (!synchronous) core.enqueueUpgrade(node, definition);
    else {
      rare(node).reactions ??= [];
      try {
        upgrade(node, definition);
        core.runReactionsOf(node);
      } catch (error) {
        core.reportError(doc.page, error);
      }
    }
    return node;
  }
  try {
    const node = core.nodeOf(construct(definition));
    if (node === null || node.type !== ELEMENT || node.ns !== HTML)
      throw new TypeError("The result must implement HTMLElement interface");
    if (node.attrs?.length || node.first !== null || node.parent !== null || node.doc !== doc || node.name !== name) {
      throw domError("NotSupportedError", "The result must be a new element of this document with that name");
    }
    if (prefix !== null) rare(node).prefix = prefix;
    rare(node).is = null;
    return node;
  } catch (error) {
    core.reportError(doc.page, error);
    const node = createUndefined(doc, name, null);
    if (prefix !== null) rare(node).prefix = prefix;
    node.kind = kinds.unknown;
    node.flags |= FAILED_CUSTOM;
    return node;
  }
};
hooks.scopedRegistryConnected = (node: N) => node.rare!.registry?.$impl.scopedDocs.$add(node.doc);

function visitElements(root: N, visit: (node: N) => void) {
  for (let at: N | null = root; at !== null; at = core.following(at, root)) {
    if (at.type === ELEMENT) visit(at);
    if (at.flags & HOST) visitElements(at.rare!.shadow!, visit);
  }
}

const lifecycle = core.splitTokens(`connectedCallback disconnectedCallback connectedMoveCallback adoptedCallback
  attributeChangedCallback`);
const formCallbacks = core.splitTokens(`formAssociatedCallback formResetCallback formDisabledCallback
  formStateRestoreCallback`);

function validateName(name: string) {
  if (!core.isValidCustomName(name)) throw domError("SyntaxError", `"${name}" is not a valid custom element name`);
}

function isConstructor(value: any): boolean {
  try {
    return !!new new Proxy(value, { construct: () => ({}) })();
  } catch {
    return false;
  }
}

function stringsOf(value: any): string[] {
  if (value === undefined) return [];
  if (!$isObject(value) || !$isCallable(value[Symbol.iterator]))
    throw new TypeError("The value cannot be converted to a sequence.");
  return Array.from(value as any, it => `${it}`);
}

function readDefinition(registry: Registry, name: string, localName: string, ctor: any): Definition {
  const { prototype } = ctor;
  if (!$isObject(prototype)) throw new TypeError("The prototype is not an object");
  const callbacks = Object.create(null);
  const read = (key: string) => {
    const callback = (callbacks[key] = prototype[key]);
    if (callback !== undefined && !$isCallable(callback)) throw new TypeError(`"${key}" is not a function`);
  };
  lifecycle.forEach(read);
  const observed = new Set(callbacks.attributeChangedCallback ? stringsOf(ctor.observedAttributes) : []);
  const disabledFeatures = stringsOf(ctor.disabledFeatures);
  const formAssociated = !!ctor.formAssociated;
  if (formAssociated) formCallbacks.forEach(read);
  return { registry, name, localName, ctor, callbacks, observed, formAssociated, disabledFeatures, stack: [] };
}

class CustomElementRegistry {
  declare $impl: Registry;

  constructor() {
    this.$impl = new Registry(this);
    core.noteScopedRegistry();
  }
  define(name: string, ctor: any, options: any = {}) {
    if ($argumentCount() < 2) core.tooFew(2);
    const registry: Registry = this.$impl;
    name = `${name}`;
    if (!$isCallable(ctor)) throw new TypeError("Argument 2 must be a constructor");
    if (options != null && !$isObject(options)) throw new TypeError("Argument 3 must be a dictionary");
    const given = options?.extends;
    const localName = given === undefined ? name : `${given}`;
    if (!isConstructor(ctor)) throw new TypeError("Argument 2 must be a constructor");
    validateName(name);
    if (registry.byName.$has(name)) {
      throw domError("NotSupportedError", `the name "${name}" has already been used with this registry`);
    }
    if (registry.byConstructor.$has(ctor)) {
      throw domError("NotSupportedError", "this constructor has already been used with this registry");
    }
    if (
      given !== undefined &&
      (registry.doc === null || !kinds.html.$has(localName) || kinds.html.$get(localName) === kinds.unknown)
    ) {
      throw domError("NotSupportedError", `"${localName}" is not an element that can be extended`);
    }
    if (registry.isDefining) throw domError("NotSupportedError", "An element is being defined");
    registry.isDefining = true;
    let definition: Definition;
    try {
      definition = readDefinition(registry, name, localName, ctor);
    } finally {
      registry.isDefining = false;
    }
    registry.byName.$set(name, definition);
    registry.byConstructor.$set(ctor, definition);
    for (const doc of registry.doc === null ? registry.scopedDocs : [registry.doc]) {
      visitElements(doc.node, node => {
        if (!(node.flags & UNDEFINED) || node.name !== localName || core.registryOf(node)?.$impl !== registry) return;
        if (localName === name || node.rare?.is === name) core.enqueueUpgrade(node, definition);
      });
    }
    registry.waiting.$get(name)?.resolve(ctor);
    registry.waiting.$delete(name);
    core.react();
  }
  get(name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this.$impl.byName.$get(`${name}`)?.ctor;
  }
  getName(ctor: any) {
    if ($argumentCount() < 1) core.tooFew(1);
    if (!$isCallable(ctor)) throw new TypeError("Argument 1 must be a constructor");
    return this.$impl.byConstructor.$get(ctor)?.name ?? null;
  }
  whenDefined(name: string) {
    try {
      const { byName, waiting } = this.$impl as Registry;
      if ($argumentCount() < 1) core.tooFew(1);
      validateName((name = `${name}`));
      if (byName.$has(name)) return Promise.$resolve(byName.$get(name)!.ctor);
      if (!waiting.$has(name)) waiting.$set(name, Promise.withResolvers());
      return waiting.$get(name)!.promise;
    } catch (error) {
      return Promise.$reject(realm.page.mirror?.adopt(error) ?? error);
    }
  }
  upgrade(root: any) {
    const registry = this.$impl;
    visitElements(unwrap(root, "upgrade"), node => {
      if (node.flags & UNDEFINED && core.registryOf(node)?.$impl === registry) tryUpgrade(node);
    });
    core.react();
  }
  initialize(root: any) {
    const registry: Registry = this.$impl;
    const node = unwrap(root, "initialize");
    if (registry.doc !== null && (node === node.doc.node || core.registryOf(node.doc.node) !== this)) {
      throw domError("NotSupportedError", "A global registry is only for the nodes of its document.");
    }
    for (let at: N | null = node; at !== null; at = core.following(at, node)) {
      if (at.type !== ELEMENT && at !== at.doc.node && !(at.flags & flags.SHADOW_ROOT)) continue;
      if (core.registryOf(at) === null) {
        rare(at).registry = registry.doc === null ? this : undefined;
        registry.scopedDocs.$add(at.doc);
      }
      if (at.flags & UNDEFINED && core.registryOf(at) === this) tryUpgrade(at);
    }
    core.react();
  }
}
expose(CustomElementRegistry);

function createRegistry(doc: Doc) {
  const registry = Object.create(CustomElementRegistry.prototype);
  registry.$impl = new Registry(registry);
  registry.$impl.doc = doc;
  return registry;
}

/** For the member of a dictionary. */
hooks.registryOption = (value: any, doc: Doc) => {
  if (value === undefined) return core.registryOf(doc.node);
  if (value === null) return core.noteScopedRegistry();
  if (!(value?.$impl instanceof Registry)) throw new TypeError("The value is not of type 'CustomElementRegistry'.");
  if (value.$impl.doc !== null && value !== core.registryOf(doc.node)) {
    throw domError("NotSupportedError", "The registry is that of another document.");
  }
  return value;
};

class CustomStateSet extends Set<string> {
  declare $impl: (name: string, on: boolean) => void;
  add(name: string) {
    super.add((name = String(name)));
    this.$impl(name, true);
    return this;
  }
  delete(name: string) {
    this.$impl((name = String(name)), false);
    return super.delete(name);
  }
  clear() {
    for (const name of this) this.delete(name);
  }
}
expose(CustomStateSet);

function customStates(node: N) {
  if (rare(node).customStates === null) {
    const set = (node.rare!.customStates = new CustomStateSet());
    $putByIdDirectPrivate(set, "impl", (name: string, on: boolean) => {
      if (node.id === 0) return;
      node.doc.engine.setCustomState(node.id, name, on);
      core.invalidate(node.doc);
    });
  }
  return node.rare!.customStates;
}

export default { prepareCustomElement, createRegistry, customStates };
