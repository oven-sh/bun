// Permissions, notifications and `navigator.storage`.
const mediaOfDevices = { camera: "video", microphone: "audio" };

const idl = require("internal/desktop/web/idl");

const { expose, internal, scope, usv } = idl;

const knownPermissions = `accelerometer background-fetch background-sync camera clipboard-read clipboard-write
  display-capture geolocation gyroscope idle-detection local-fonts local-network-access magnetometer microphone midi
  notifications payment-handler periodic-background-sync persistent-storage push screen-wake-lock storage-access
  window-management`.split(/\s+/);
const inElectron = { "camera": "media", "microphone": "media", "clipboard-write": "clipboard-sanitized-write" };

class PermissionStatus extends idl.EventTarget {
  #name: string;

  constructor(key: unknown = undefined, name = "") {
    idl.illegal(key);
    super();
    this.#name = name;
  }

  get name() {
    return this.#name;
  }
  get state() {
    const mediaType = mediaOfDevices[this.#name];
    return scope.env.checkPermission(inElectron[this.#name] ?? this.#name, mediaType && { mediaType });
  }
}
idl.defineHandlers(PermissionStatus.prototype, ["change"]);
expose(PermissionStatus);

class Permissions {
  constructor(key: unknown = undefined) {
    idl.illegal(key);
  }

  async query(descriptor: any) {
    if (!(this instanceof Permissions) || !$isObject(descriptor))
      throw new TypeError("parameter 1 is not of type 'object'.");
    if (scope.disposed) throw idl.error("InvalidStateError", "The document is not active.");
    return new PermissionStatus(internal, idl.oneOf(descriptor.name, knownPermissions));
  }
}
expose(Permissions);

let valuesOf: (notification: any) => any;

class Notification extends idl.EventTarget {
  #values: any;
  #shown: { close(): void } | undefined;

  static get permission() {
    const state = scope.env.secure ? scope.env.checkPermission("notifications") : "denied";
    return state === "prompt" ? "default" : state;
  }

  static get maxActions() {
    return 2;
  }

  static requestPermission(callback: any = undefined) {
    return idl.adopt(scope.env.dom.permission("notifications"), state => {
      callback?.(state);
      return state;
    });
  }

  static {
    valuesOf = notification => notification.#values;
  }

  constructor(title: string, options: any = undefined) {
    idl.need(arguments.length, 1);
    title = `${title}`;
    const {
      actions = [],
      badge,
      body = "",
      data = null,
      dir = "auto",
      icon,
      image,
      lang = "",
    } = idl.dictionary(options);
    const {
      renotify,
      requireInteraction,
      silent = null,
      tag = "",
      timestamp = Date.now(),
      vibrate,
    } = idl.dictionary(options);
    if (idl.sequence(actions).length > 0)
      throw new TypeError("Actions are only supported for persistent notifications.");
    if (silent && vibrate !== undefined)
      throw new TypeError("Silent notifications must not specify vibration patterns.");
    if (renotify && tag === "") throw new TypeError("Notifications which set the renotify flag must specify a tag.");
    const url = (given: unknown) => (given === undefined ? "" : (idl.parseUrl(usv(given))?.href ?? ""));
    super();
    this.#values = {
      title,
      dir: idl.oneOf(dir, ["auto", "ltr", "rtl"]),
      lang: /^(?:[a-z]{1,8}(?:-[a-z\d]{1,8})*)?$/i.test(lang) ? `${lang}` : "",
      body: `${body}`,
      tag: `${tag}`,
      icon: url(icon),
      badge: url(badge),
      image: url(image),
      vibrate: Object.freeze([vibrate ?? []].flat().map(time => Math.min(time >>> 0, 10000))),
      timestamp: idl.unsignedLongLong(timestamp),
      renotify: !!renotify,
      silent: silent === null ? null : !!silent,
      requireInteraction: !!requireInteraction,
      data: idl.native.structuredClone(data),
      actions: Object.freeze([]),
    };
    const emit = (type: string) => idl.dispatchInTask(this, new idl.Event(type, { cancelable: type === "click" }));
    if (Notification.permission !== "granted") idl.queueTask(emit, "error");
    else this.#shown = scope.env.notify?.(title, this.#values.body, !!silent, type => idl.runTask(emit, type));
  }

  close() {
    this.#shown?.close();
  }
}
for (const name of `title dir lang body tag icon badge image vibrate timestamp renotify silent requireInteraction data
  actions`.split(/\s+/)) {
  idl.attribute(Notification, name, self => valuesOf(self)[name]);
}
idl.defineHandlers(Notification.prototype, ["click", "show", "error", "close"]);
if (!scope.isWindow) delete (Notification as any).requestPermission;
expose(Notification);

class StorageManager {
  constructor(key: unknown = undefined) {
    idl.illegal(key);
  }

  #check() {
    if (scope.disposed || scope.env.origin === "null")
      throw new TypeError("The operation is not supported in this context.");
  }

  async persisted() {
    this.#check();
    return true;
  }
  async persist() {
    this.#check();
    return true;
  }
  async estimate() {
    this.#check();
    const { indexedDB, caches } = await scope.env.usage();
    const usageDetails = { ...(indexedDB > 0 && { indexedDB }), ...(caches > 0 && { caches }) };
    return { quota: 2 ** 36, usage: indexedDB + caches, usageDetails };
  }
  async getDirectory() {
    if (scope.env.origin === "null") throw idl.error("SecurityError", "Storage directory access is denied.");
    this.#check();
    return require("internal/desktop/web/file_system").root();
  }
}
if (!scope.isWindow) delete (StorageManager.prototype as any).persist;
expose(StorageManager);

export default { Notification, PermissionStatus, Permissions, StorageManager };
