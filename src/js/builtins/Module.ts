interface Module {
  id: string;

  $require(id: string): any;
  children: Module[];
}

export function require(this: Module, id: string) {
  const existing = $requireMap.$get(id) || $requireMap.$get((id = $resolveSync(id, this.id, false)));
  if (existing) {
    return existing.exports;
  }

  if (id.endsWith(".json") || id.endsWith(".toml") || id.endsWith(".node")) {
    return $internalRequire(id);
  }

  let out = this.$require(id);
  if (out === -1) {
    return $internalRequire(id);
  }
  const fn = globalThis.$textDecoderStreamDecoder(out);
  if (fn !== out) {
    fn(out, out.exports, out.require, out.id, out.filename);
    $requireMap.$set(id, out);
  }

  const existing2 = $requireMap.$get(id);
  if (existing2) {
    return existing2.exports;
  }

  $requireMap.$set(id, { id, exports: out, loaded: true, filename: id });
  return out;
}

export function requireResolve(this: Module, id: string) {
  return $resolveSync(id, this.id, false);
}
