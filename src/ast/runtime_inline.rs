//! Self-contained JavaScript source for the runtime helpers that lowering can
//! emit when no bundling step will inline `bun:wrap` for us.
//!
//! `Bun.Transpiler` and `bun build --no-bundle` hand their output to another
//! runtime, so `import { __using } from "bun:wrap"` is unloadable there. For
//! those callers the printer emits `var __using_<hash> = <source>;` instead,
//! using the sources below.
//!
//! Each one mirrors its definition in `src/runtime.js` (`__using` /
//! `__callDispose` mirror `RUNTIME_USING_OTHER` in `src/bundler/ParseTask.rs`,
//! the variant that does not assume `Symbol.dispose` or `SuppressedError`
//! exist) with its internal dependencies inlined, so nothing leaks a bare
//! `__defProp`-style name into the user's scope. Keep them in sync.

/// JavaScript for the value of `name`, or `None` when the helper has no
/// standalone definition.
///
/// Only the helpers that lowering can reach without a bundler need an entry:
/// legacy/TC39 decorators and `using`. The rest (`__require`, `__export`, …)
/// are only produced by the bundler, which links the real runtime module.
pub fn source(name: &[u8]) -> Option<&'static str> {
    Some(match name {
        b"__legacyDecorateClassTS" => LEGACY_DECORATE_CLASS_TS,
        b"__legacyDecorateParamTS" => LEGACY_DECORATE_PARAM_TS,
        b"__legacyMetadataTS" => LEGACY_METADATA_TS,
        b"__decoratorStart" => DECORATOR_START,
        b"__decoratorMetadata" => DECORATOR_METADATA,
        b"__decorateElement" => DECORATE_ELEMENT,
        b"__runInitializers" => RUN_INITIALIZERS,
        b"__privateIn" => PRIVATE_IN,
        b"__privateGet" => PRIVATE_GET,
        b"__privateAdd" => PRIVATE_ADD,
        b"__privateSet" => PRIVATE_SET,
        b"__privateMethod" => PRIVATE_METHOD,
        b"__using" => USING,
        b"__callDispose" => CALL_DISPOSE,
        _ => return None,
    })
}

const LEGACY_DECORATE_CLASS_TS: &str = r#"function (decorators, target, key, desc) {
  var c = arguments.length,
    r = c < 3 ? target : desc === null ? (desc = Object.getOwnPropertyDescriptor(target, key)) : desc,
    d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function")
    r = Reflect.decorate(decorators, target, key, desc);
  else
    for (var i = decorators.length - 1; i >= 0; i--)
      if ((d = decorators[i])) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return (c > 3 && r && Object.defineProperty(target, key, r), r);
}"#;

const LEGACY_DECORATE_PARAM_TS: &str =
    "(index, decorator) => (target, key) => decorator(target, key, index)";

const LEGACY_METADATA_TS: &str = r#"(k, v) => {
  if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}"#;

const DECORATOR_START: &str = r#"base => [, , , Object.create(base?.[Symbol.metadata || Symbol.for("Symbol.metadata")] ?? null)]"#;

const DECORATOR_METADATA: &str = r#"(array, target) => {
  var key = Symbol.metadata || Symbol.for("Symbol.metadata");
  return key in target
    ? Object.defineProperty(target, key, { enumerable: true, configurable: true, writable: true, value: array[3] })
    : (target[key] = array[3]);
}"#;

const RUN_INITIALIZERS: &str = r#"(array, flags, self, value) => {
  for (var i = 0, fns = array[flags >> 1], n = fns && fns.length; i < n; i++)
    flags & 1 ? fns[i].call(self) : (value = fns[i].call(self, value));
  return value;
}"#;

const PRIVATE_IN: &str = r#"(member, obj) => {
  if (Object(obj) !== obj) throw TypeError('Cannot use the "in" operator on this value');
  return member.has(obj);
}"#;

const PRIVATE_GET: &str = r#"(obj, member, getter) => {
  if (!member.has(obj)) throw TypeError("Cannot read from private field");
  return getter ? getter.call(obj) : member.get(obj);
}"#;

const PRIVATE_ADD: &str = r#"(obj, member, value) => {
  if (member.has(obj)) throw TypeError("Cannot add the same private member more than once");
  return member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
}"#;

const PRIVATE_SET: &str = r#"(obj, member, value, setter) => {
  if (!member.has(obj)) throw TypeError("Cannot write to private field");
  return setter ? setter.call(obj, value) : member.set(obj, value), value;
}"#;

const PRIVATE_METHOD: &str = r#"(obj, member, method) => {
  if (!member.has(obj)) throw TypeError("Cannot access private method");
  return method;
}"#;

const USING: &str = r#"(() => {
  var __dispose = Symbol.dispose || Symbol.for("Symbol.dispose"),
    __asyncDispose = Symbol.asyncDispose || Symbol.for("Symbol.asyncDispose");
  return (stack, value, async) => {
    if (value != null) {
      if (typeof value !== "object" && typeof value !== "function")
        throw TypeError('Object expected to be assigned to "using" declaration');
      var dispose;
      if (async) dispose = value[__asyncDispose];
      if (dispose === void 0) dispose = value[__dispose];
      if (typeof dispose !== "function") throw TypeError("Object not disposable");
      stack.push([async, dispose, value]);
    } else if (async) {
      stack.push([async]);
    }
    return value;
  };
})()"#;

const CALL_DISPOSE: &str = r#"(stack, error, hasError) => {
  var E =
      typeof SuppressedError === "function"
        ? SuppressedError
        : function (e, s, m, _) {
            return (_ = Error(m)), (_.name = "SuppressedError"), (_.error = e), (_.suppressed = s), _;
          },
    fail = e =>
      (error = hasError ? new E(e, error, "An error was suppressed during disposal") : ((hasError = true), e)),
    next = it => {
      while ((it = stack.pop())) {
        try {
          var result = it[1] && it[1].call(it[2]);
          if (it[0]) return Promise.resolve(result).then(next, e => (fail(e), next()));
        } catch (e) {
          fail(e);
        }
      }
      if (hasError) throw error;
    };
  return next();
}"#;

const DECORATE_ELEMENT: &str = r#"(() => {
  var __defProp = Object.defineProperty,
    __getOwnPropDesc = Object.getOwnPropertyDescriptor,
    __knownSymbol = (name, symbol) => ((symbol = Symbol[name]) ? symbol : Symbol.for("Symbol." + name)),
    __typeError = msg => {
      throw TypeError(msg);
    },
    __defNormalProp = (obj, key, value) =>
      key in obj
        ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value })
        : (obj[key] = value),
    __name = (target, name) => (
      __defProp(target, "name", { value: name, enumerable: false, configurable: true }), target
    ),
    __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg),
    __privateIn = (member, obj) =>
      Object(obj) !== obj ? __typeError('Cannot use the "in" operator on this value') : member.has(obj),
    __privateGet = (obj, member, getter) => (
      __accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj)
    ),
    __privateSet = (obj, member, value, setter) => (
      __accessCheck(obj, member, "write to private field"),
      setter ? setter.call(obj, value) : member.set(obj, value),
      value
    ),
    __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method),
    __decoratorStrings = ["class", "method", "getter", "setter", "accessor", "field", "value", "get", "set"],
    __expectFn = fn => (fn !== void 0 && typeof fn !== "function" ? __typeError("Function expected") : fn),
    __decoratorContext = (kind, name, done, metadata, fns) => ({
      kind: __decoratorStrings[kind],
      name,
      metadata,
      addInitializer: fn => (done._ ? __typeError("Already initialized") : fns.push(__expectFn(fn || null))),
    }),
    __decoratorMetadata = (array, target) => __defNormalProp(target, __knownSymbol("metadata"), array[3]);
  return (array, flags, name, decorators, target, extra) => {
    var fn,
      it,
      done,
      ctx,
      access,
      k = flags & 7,
      s = !!(flags & 8),
      p = !!(flags & 16);
    var j = k > 3 ? array.length + 1 : k ? (s ? 1 : 2) : 0,
      key = __decoratorStrings[k + 5];
    var initializers = k > 3 && (array[j - 1] = []),
      extraInitializers = array[j] || (array[j] = []);
    var desc =
      k &&
      (!p && !s && (target = target.prototype),
      k < 5 &&
        (k > 3 || !p) &&
        __getOwnPropDesc(
          k < 4
            ? target
            : {
                get [name]() {
                  return __privateGet(this, extra);
                },
                set [name](x) {
                  __privateSet(this, extra, x);
                },
              },
          name,
        ));
    k ? p && k < 4 && __name(extra, (k > 2 ? "set " : k > 1 ? "get " : "") + name) : __name(target, name);

    for (var i = decorators.length - 1; i >= 0; i--) {
      ctx = __decoratorContext(k, name, (done = {}), array[3], extraInitializers);

      if (k) {
        ((ctx.static = s),
          (ctx.private = p),
          (access = ctx.access = { has: p ? x => __privateIn(target, x) : x => name in x }));
        if (k ^ 3)
          access.get = p
            ? x => (k ^ 1 ? __privateGet : __privateMethod)(x, target, k ^ 4 ? extra : desc.get)
            : x => x[name];
        if (k > 2)
          access.set = p ? (x, y) => __privateSet(x, target, y, k ^ 4 ? extra : desc.set) : (x, y) => (x[name] = y);
      }

      it = (0, decorators[i])(
        k ? (k < 4 ? (p ? extra : desc[key]) : k > 4 ? void 0 : { get: desc.get, set: desc.set }) : target,
        ctx,
      );
      done._ = 1;

      if (k ^ 4 || it === void 0)
        __expectFn(it) && (k > 4 ? initializers.unshift(it) : k ? (p ? (extra = it) : (desc[key] = it)) : (target = it));
      else if (typeof it !== "object" || it === null) __typeError("Object expected");
      else
        (__expectFn((fn = it.get)) && (desc.get = fn),
          __expectFn((fn = it.set)) && (desc.set = fn),
          __expectFn((fn = it.init)) && initializers.unshift(fn));
    }

    return (
      k || __decoratorMetadata(array, target),
      desc && __defProp(target, name, desc),
      p ? (k ^ 4 ? extra : desc) : target
    );
  };
})()"#;

#[cfg(test)]
mod tests {
    use super::source;

    /// Every helper legacy/TC39 decorator and `using` lowering can reach
    /// without a bundler must have a standalone definition, otherwise the
    /// printer falls back to the unloadable `bun:wrap` import.
    #[test]
    fn every_transform_only_helper_has_a_source() {
        for name in [
            &b"__legacyDecorateClassTS"[..],
            b"__legacyDecorateParamTS",
            b"__legacyMetadataTS",
            b"__decoratorStart",
            b"__decoratorMetadata",
            b"__decorateElement",
            b"__runInitializers",
            b"__privateIn",
            b"__privateGet",
            b"__privateAdd",
            b"__privateSet",
            b"__privateMethod",
            b"__using",
            b"__callDispose",
        ] {
            assert!(
                source(name).is_some(),
                "{} has no inline source",
                core::str::from_utf8(name).unwrap()
            );
        }
    }

    #[test]
    fn bundler_only_helpers_have_no_source() {
        assert!(source(b"__require").is_none());
        assert!(source(b"__export").is_none());
        assert!(source(b"__reExport").is_none());
    }
}
