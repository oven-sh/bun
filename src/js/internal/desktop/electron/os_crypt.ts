// `safeStorage` with the keys and the format of Electron, so that each can read what the other has written.
const { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } = require("node:crypto");
const native = require("internal/desktop/native");
const { app } = require("internal/desktop/app");

const isWindows = process.platform === "win32";
const isLinux = !isWindows && process.platform !== "darwin";
const PREFIX = isLinux ? "v11" : "v10";
const IV = Buffer.alloc(16, " ");
const derive = (password: string) => pbkdf2Sync(password, "saltysalt", isLinux ? 1 : 1003, 16, "sha1");
const protect = (data: Uint8Array, protects: boolean) =>
  Buffer.from(native.takeBlob(native.ask("protectData", { blob: native.putBlob(data), protects })));

let key: Buffer | undefined;
let loading: Promise<boolean> | undefined;
let allowsPlainText = false;

function windowsKey() {
  const fs = require("node:fs");
  const file = require("node:path").join(app.getPath("sessionData"), "Local State");
  const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const stored = state.os_crypt?.encrypted_key;
  if (stored) return protect(Buffer.from(stored, "base64").subarray("DPAPI".length), false);
  const fresh = randomBytes(32);
  const encrypted_key = Buffer.concat([Buffer.from("DPAPI"), protect(fresh, true)]).toString("base64");
  fs.mkdirSync(app.getPath("sessionData"), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...state, os_crypt: { ...state.os_crypt, encrypted_key } }));
  return fresh;
}

async function readKey(): Promise<Buffer> {
  if (isWindows) return windowsKey();
  const fresh = randomBytes(16).toString("base64");
  const owner = (app as any).commandLine.getSwitchValue("safe-storage-name") || app.name;
  if (isLinux) return derive(await native.request("chromiumPassword", { application: owner, fresh }));
  if ((app as any).commandLine.hasSwitch("use-mock-keychain")) return derive("mock_password");
  const other = (app as any).commandLine.getSwitchValue("safe-storage-copy-from");
  const stored = await keychainPassword(other || owner);
  if (other && stored === null) throw new Error(`${other} has no key`);
  if (other || stored === null) {
    await Bun.secrets.set({ service: owner + " Safe Storage", name: owner + " Key", value: stored ?? fresh });
  }
  return derive(stored ?? fresh);
}

/** Old versions of Electron left out " Key". */
async function keychainPassword(owner: string) {
  const service = owner + " Safe Storage";
  return (await readSecret({ service, name: owner + " Key" })) ?? (await readSecret({ service, name: owner }));
}

const prompt = Promise.withResolvers<void>();

async function readSecret(item: { service: string; name: string }) {
  const { blob, asks } = await native.request("keychain.read", item).catch(() => ({}));
  if (blob) return Buffer.from(native.takeBlob(blob)).toString();
  if (asks) prompt.resolve();
  return Bun.secrets.get(item);
}

function load() {
  return (loading ??= readKey().then(
    found => !!(key = found),
    error => (process.emitWarning(`safeStorage has no key: ${error.message}`, "DesktopWarning"), false),
  ));
}

function encrypt(text: string): Buffer {
  if (isWindows) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    return Buffer.concat([Buffer.from(PREFIX), nonce, cipher.update(text), cipher.final(), cipher.getAuthTag()]);
  }
  const cipher = createCipheriv("aes-128-cbc", key ?? derive("peanuts"), IV);
  return Buffer.concat([Buffer.from(key ? PREFIX : "v10"), cipher.update(text), cipher.final()]);
}

function decrypt(data: Buffer): Buffer {
  const prefix = data.latin1Slice(0, 3);
  if (isWindows) {
    if (prefix !== PREFIX) return protect(data, false);
    const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(3, 15));
    decipher.setAuthTag(data.subarray(-16));
    return Buffer.concat([decipher.update(data.subarray(15, -16)), decipher.final()]);
  }
  const decipher = createDecipheriv("aes-128-cbc", prefix === PREFIX ? key : derive("peanuts"), IV);
  return Buffer.concat([decipher.update(data.subarray(3)), decipher.final()]);
}

const isAvailable = () => app.isReady() && (key !== undefined || allowsPlainText);

function check(method: string) {
  if (!app.isReady()) throw new Error("safeStorage cannot be used before app is ready");
  if (!isAvailable()) throw new Error(`Error while running safeStorage.${method}. Encryption is not available.`);
}

const safeStorage = {
  isEncryptionAvailable: isAvailable,
  isAsyncEncryptionAvailable: async () => isAvailable(),
  encryptString(text: string) {
    check("encryptString");
    return encrypt(String(text));
  },
  decryptString(data: Buffer) {
    check("decryptString");
    if (!Buffer.isBuffer(data)) throw new TypeError("Expected the first argument of decryptString() to be a buffer");
    if (data.length === 0) return "";
    const failure = "Error while decrypting the ciphertext provided to safeStorage.decryptString.";
    if (!/^v1[01]$/.test(data.latin1Slice(0, 3))) {
      throw new Error(failure + " Ciphertext does not appear to be encrypted.");
    }
    try {
      return decrypt(data).toString();
    } catch {
      throw new Error(failure);
    }
  },
  encryptStringAsync: async (text: string) => safeStorage.encryptString(text),
  decryptStringAsync: async (data: Buffer) => ({ result: safeStorage.decryptString(data), shouldReEncrypt: false }),
  setUsePlainTextEncryption(on: boolean) {
    allowsPlainText = isLinux && !!on;
  },
  ...(isLinux && {
    getSelectedStorageBackend: () => (!app.isReady() ? "unknown" : key ? "gnome_libsecret" : "basic_text"),
  }),
};

export default {
  canEncrypt: () => key !== undefined || isLinux,
  decrypt,
  encrypt,
  load,
  safeStorage,
  whenAsking: prompt.promise,
};
