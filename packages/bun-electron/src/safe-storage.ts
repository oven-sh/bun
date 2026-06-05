// safeStorage — Electron-compatible encrypted string storage.
//
// Electron backs this with the OS keychain (Keychain / libsecret / DPAPI).
// Here it is backed by AES-256-GCM with a key derived from a per-user secret
// file, which gives the same API contract and real encryption. The ciphertext
// format is versioned so decryptString can reject foreign blobs.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const MAGIC = Buffer.from("bunelec1"); // 8-byte format tag

let cachedKey: Buffer | null = null;

function keyMaterialPath(): string {
  const base =
    process.platform === "win32"
      ? (process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"))
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support")
        : (process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"));
  return path.join(base, "bun-electron", "safe-storage.key");
}

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const keyPath = process.env.BUN_ELECTRON_SAFE_STORAGE_KEY ?? keyMaterialPath();
  let secret: Buffer;
  if (existsSync(keyPath)) {
    secret = readFileSync(keyPath);
  } else {
    secret = randomBytes(32);
    mkdirSync(path.dirname(keyPath), { recursive: true });
    writeFileSync(keyPath, secret, { mode: 0o600 });
    try {
      chmodSync(keyPath, 0o600);
    } catch {}
  }
  cachedKey = scryptSync(secret, "bun-electron-safe-storage", 32);
  return cachedKey;
}

export const safeStorage = {
  isEncryptionAvailable(): boolean {
    try {
      loadKey();
      return true;
    } catch {
      return false;
    }
  },

  encryptString(plainText: string): Buffer {
    if (typeof plainText !== "string") {
      throw new TypeError("Expected a string");
    }
    if (!this.isEncryptionAvailable()) {
      throw new Error("Encryption is not available");
    }
    const key = loadKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    // MAGIC | iv(12) | tag(16) | ciphertext
    return Buffer.concat([MAGIC, iv, tag, enc]);
  },

  decryptString(encrypted: Buffer): string {
    if (!Buffer.isBuffer(encrypted)) {
      throw new TypeError("Expected a Buffer");
    }
    if (!this.isEncryptionAvailable()) {
      throw new Error("Decryption is not available");
    }
    if (encrypted.length < MAGIC.length + 28 || !encrypted.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error("Unable to decrypt: unrecognized ciphertext format");
    }
    const key = loadKey();
    const iv = encrypted.subarray(8, 20);
    const tag = encrypted.subarray(20, 36);
    const body = encrypted.subarray(36);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  },
};
