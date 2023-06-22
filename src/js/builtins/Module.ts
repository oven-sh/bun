interface Module {
  id: string;
  path: string;

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

  const existing2 = $requireMap.$get(id);
  if (existing2) {
    return existing2.exports;
  }

  $requireMap.$set(id, { id, exports: out, loaded: true, filename: id });
  return out;
}

export function requireResolve(this: Module, id: string) {
  return $resolveSync(id, this.path, false);
}
