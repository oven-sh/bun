// A reference panic or a failed read becomes a value; nothing here throws on input.
export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };
