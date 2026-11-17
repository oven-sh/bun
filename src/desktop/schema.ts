// What the schemas in this directory have in common.
import * as b from "../codegen/bindgen-lib.ts";

export const js = { capability: "js", throws: true } as const;
export const text = b.string.loose.utf8;
export const textIfAny = b.string.utf8.otherAsNull;
export const ownedTextIfAny = b.string.utf8.owned.otherAsNull;
export const flag = b.bool.loose.default(false);
export const flagIfAny = b.bool.loose.optional;
export const number = b.f64.loose;
export const numberIfAny = b.f64.otherAsNull;
export const anything = b.any.omittable;
export const texts = b.array(b.string.utf8);
export const ownedTexts = b.array(b.string.utf8.owned);

export const returnsObject = { returns: b.any, ...js } as const;
export const returnsPromise = { returns: b.any, rejects: true, ...js } as const;
export const returnsText = { returns: b.string.utf8, ...js } as const;
export const returnsFlag = { returns: b.bool, ...js } as const;

const listen = { args: { name: b.any, listener: anything }, ...returnsObject };
/** `notices_listeners!` */
export const noticesListeners = { on: listen, addListener: listen, prependListener: listen };

/** Methods that have nothing to act on here. They share one Rust function. */
export const sharing = (rustName: string, names: string, signature: object = {}) =>
  Object.fromEntries(names.split(" ").map(name => [name, { ...signature, rustName }]));

/** `getName()` and `setName()` are the functions of the property `name`. */
export const withAccessors = (members: Record<string, object>) =>
  Object.fromEntries(
    Object.entries(members).map(([name, member]) => [
      name,
      /^[gs]et[A-Z][a-z]/.test(name)
        ? { rustName: name.replace(/[A-Z]/g, it => "_" + it.toLowerCase()), ...member }
        : member,
    ]),
  );
