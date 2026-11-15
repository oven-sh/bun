// DIAGNOSTIC: TS100150 1
// RUN(PATH): lower
// PATH-LABEL: function {{*}}name="path"
// PATH-NOT: Resolve
// PATH: = String string="{{*}}imports/values.ts"
// PATH-NOT: Resolve
// PATH: Return

// RUN(URL): lower
// URL-LABEL: function {{*}}name="url"
// URL-NOT: ImportMeta
// URL: = ResolveModule module=m{{*}} [isURL]
// URL: Return

// RUN(COMPUTED): lower
// COMPUTED-LABEL: function {{*}}name="computed"
// COMPUTED-NOT: isForRequire
// COMPUTED: = ResolveDynamic
// COMPUTED-NOT: isForRequire
// COMPUTED: Return

// RUN(FEW): lower
// FEW-LABEL: function {{*}}name="oneOfFew"
// FEW-NOT: ResolveDynamic
// FEW: SwitchString
// FEW: = String string="{{*}}imports/values.ts"
// FEW: = String string="{{*}}imports/nested.ts"
// FEW-NOT: ResolveDynamic
// FEW: Return

// RUN(MISSING): lower
// MISSING-LABEL: function {{*}}name="missing"
// MISSING-NOT: isForRequire
// MISSING: = ResolveDynamic
// MISSING-NOT: isForRequire
// MISSING-NOT: ThrowModuleFailure
// MISSING: Return

// RUN(PATHS): lower
// PATHS-LABEL: function {{*}}name="withPaths"
// PATHS-NOT: ResolveModule
// PATHS: = Call
// PATHS: Return

// RUN(RELATIVE): lower
// RELATIVE-LABEL: function {{*}}name="relative"
// RELATIVE-NOT: ResolveModule
// RELATIVE: = Call
// RELATIVE: Return

export function path() {
  return require.resolve("./imports/values");
}

export function url() {
  return import.meta.resolve("values-package");
}

export function computed(name) {
  return require.resolve(name);
}

export function oneOfFew(isOther) {
  return require.resolve(isOther ? "./imports/values" : "./imports/nested");
}

export function missing() {
  return require.resolve("./imports/none");
}

export function withPaths() {
  return require.resolve("./imports/values", { paths: [] });
}

export function relative() {
  return import.meta.resolve("./imports/values");
}
