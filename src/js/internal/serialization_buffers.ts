// Shared Buffer tagging for JSC-serialized transports (advanced IPC and
// node:v8 serialize/deserialize). JSC's SerializedScriptValue has no
// host-object hook, so Buffers round-trip as plain Uint8Arrays; node preserves
// them via its serializer delegate (lib/internal/child_process/serialization.js
// _writeHostObject / node:v8 DefaultSerializer). Senders walk the value and,
// when Buffers are present, ship the [value, buffers] envelope: each `buffers`
// entry aliases a view inside `value`, JSC preserves object identity across
// one serialized graph, and the receiver restores the Buffer prototype on the
// aliased entries — reaching every occurrence with no path bookkeeping.
//
// The walk avoids re-running the sender's getters: it descends through data
// properties only (descriptor-checked), so getters keep their
// run-exactly-once-during-send contract — the serializer alone evaluates
// them. The cost is that a Buffer returned by a getter arrives as a plain
// Uint8Array, where node (whose tagging happens inside the serializer)
// preserves it. The walk is not user-code-free: Proxy ownKeys/gOPD traps and
// patched Map/Set iterators do run here (as they do again inside the
// serializer) — a sender lying through them only mis-tags its own value,
// since the serializer reads the real entries either way.

const { Buffer } = require("node:buffer");
const BufferPrototype = Buffer.prototype;
const isBuffer = Buffer.isBuffer;

/** Returns null when `value` holds no Buffers, else the [value, buffers] envelope. */
function tagBuffers(value: unknown): [unknown, unknown[]] | null {
  let buffers: unknown[] | null = null;
  let visited: Set<object> | null = null;
  const stack = [value];
  while (stack.length !== 0) {
    const current = stack.pop();
    if (current === null || typeof current !== "object") continue;
    visited ??= new Set();
    if (visited.$has(current)) continue;
    visited.$add(current);
    if ($isTypedArrayView(current)) {
      if (isBuffer(current)) (buffers ??= []).push(current);
      // Other ArrayBuffer views round-trip with their type already.
      continue;
    }
    if ($isMap(current)) {
      for (const { 0: key, 1: entry } of current) {
        stack.push(key);
        stack.push(entry);
      }
      continue;
    }
    if ($isSet(current)) {
      for (const entry of current) stack.push(entry);
      continue;
    }
    // Objects, arrays and errors: the serializer walks own enumerable
    // properties. Only data properties are descended so no getter runs here.
    const keys = Object.keys(current);
    for (let i = 0; i < keys.length; i++) {
      const desc = Object.getOwnPropertyDescriptor(current, keys[i]);
      if (desc && "value" in desc) stack.push(desc.value);
    }
  }
  return buffers === null ? null : [value, buffers];
}

/**
 * Receive side: restore the Buffer prototype on the envelope's aliased views
 * and hand back the value. The envelope came off a wire or byte blob, so its
 * shape is validated before it is trusted.
 */
function restoreBuffers(envelope: unknown): unknown {
  if (!$isJSArray(envelope) || (envelope as unknown[]).length !== 2 || !$isJSArray((envelope as unknown[])[1])) {
    throw new Error("failed to parse serialized buffer envelope");
  }
  const buffers = (envelope as unknown[])[1] as unknown[];
  for (let i = 0; i < buffers.length; i++) {
    const view = buffers[i];
    // Fresh from deserialization: plain Uint8Arrays the sender tagged.
    if ($isTypedArrayView(view)) Object.setPrototypeOf(view, BufferPrototype);
  }
  return (envelope as unknown[])[0];
}

export default { tagBuffers, restoreBuffers };
