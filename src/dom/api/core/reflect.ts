// The members that reflect attributes, for schemas.
import * as families from "./reflect.bind.ts";

const words = (list: string) => list.split(/\s+/).filter(Boolean);
const atom = (name: string) => `crate::api::core::atom!(${JSON.stringify(name)})`;
const strings = (list: string) => `&[${words(list).map(it => JSON.stringify(it))}]`;

const renamed: Record<string, string> = {
  acceptCharset: "accept-charset",
  ch: "char",
  chOff: "charoff",
  className: "class",
  defaultChecked: "checked",
  defaultMuted: "muted",
  defaultSelected: "selected",
  defaultValue: "value",
  encoding: "enctype",
  htmlFor: "for",
  httpEquiv: "http-equiv",
};
const encodings = "application/x-www-form-urlencoded multipart/form-data text/plain";
/** The keywords, the value for a missing attribute, and the one for an invalid attribute. */
const enumerations: Record<string, [string, string | null, string?]> = {
  as: [
    "fetch audio document embed font image manifest object report script sharedworker style track video worker xslt",
    "",
  ],
  autocomplete: ["on off", "on"],
  crossOrigin: ["anonymous use-credentials", null, "anonymous"],
  decoding: ["sync async auto", "auto"],
  dir: ["ltr rtl auto", ""],
  encoding: [encodings, "application/x-www-form-urlencoded"],
  enctype: [encodings, "application/x-www-form-urlencoded"],
  enterKeyHint: ["enter done go next previous search send", ""],
  fetchPriority: ["high low auto", "auto"],
  formEnctype: [encodings, "", "application/x-www-form-urlencoded"],
  formMethod: ["get post dialog", "", "get"],
  inputMode: ["none text tel url email numeric decimal search", ""],
  kind: ["subtitles captions descriptions chapters metadata", "subtitles", "metadata"],
  loading: ["lazy eager", "eager"],
  method: ["get post dialog", "get"],
  popoverTargetAction: ["toggle show hide", "toggle"],
  preload: ["none metadata auto", "metadata"],
  referrerPolicy: [
    "no-referrer no-referrer-when-downgrade same-origin origin strict-origin origin-when-cross-origin strict-origin-when-cross-origin unsafe-url",
    "",
  ],
  scope: ["row col rowgroup colgroup", ""],
  shadowRootMode: ["open closed", ""],
  shadowRootSlotAssignment: ["named manual", "named"],
  virtualKeyboardPolicy: ["auto manual", ""],
};
const limits: Record<string, number> = { span: 1000, colSpan: 1000, rowSpan: 65534 };
const nullIsEmpty = /^(?:bgColor|cellPadding|cellSpacing|margin\w+|text|[av]?[lL]ink)$/;

function member(property: string, type: string, rest: string) {
  const name = atom(renamed[property] ?? property.toLowerCase());
  if (type === "?") return families.ReflectBoolean.of(name);
  if (type === "@") return families.ReflectUrl.of(name);
  if (type === "^") return families.ReflectTrustedUrl.of(name);
  if (type === "%") return families.ReflectTrustedString.of(name);
  if (type === "!") return families.ReflectNullToEmpty.of(name);
  if (type === "~") return families.ReflectString.of(name);
  if (type === "$") return families.ReflectUsvString.of(name);
  if (type !== "") {
    const min = type === "+" ? 0 : type === ">" ? 1 : "i32::MIN";
    const throwsBelow =
      type === "+" && rest === "-1" ? "Some(0)" : property === "size" && type === ">" ? "Some(1)" : "None";
    const max = property in limits ? `Some(${limits[property]})` : "None";
    const key = `crate::api::core::reflect::Integer { name: ${name}, default: ${rest}, min: ${min}, max: ${max}, throws_below: ${throwsBelow} }`;
    return (type === "=" || rest === "-1" ? families.ReflectLong : families.ReflectUnsigned).of(key);
  }
  if (Object.hasOwn(enumerations, property)) {
    const [keywords, missing, invalid = missing] = enumerations[property];
    const key = `crate::api::core::reflect::Enumerated { name: ${name}, keywords: ${strings(keywords)}, missing: ${JSON.stringify(missing ?? "")}, invalid: ${JSON.stringify(invalid)} }`;
    return (missing === null ? families.ReflectNullableEnumerated : families.ReflectEnumerated).of(key);
  }
  return (nullIsEmpty.test(property) ? families.ReflectNullToEmpty : families.ReflectString).of(name);
}

/**
 * `name` is a string or an enumeration, `name?` a boolean, `name@` a URL, `name=1` an integer with its default, and
 * `name+1` one that is not negative, `name>1` a positive one, `name~` a string even if there is such an enumeration,
 * `name!` one that null empties, `name$` a `USVString`, and `name^` a URL and `name%` a string for Trusted Types to check.
 */
export function reflect(list: string) {
  return Object.fromEntries(
    words(list).map(entry => {
      const [, property, type, rest] = /^(\w+)([?@=+>~!$^%]?)(.*)$/.exec(entry)!;
      return [property, member(property, type, rest)];
    }),
  );
}

export const nullable = (attribute: string) => families.ReflectNullable.of(atom(attribute));
export const reference = (attribute: string) => families.ReflectElement.of(atom(attribute));
export const references = (attribute: string) => families.ReflectElements.of(atom(attribute));
export const tokenList = (attribute: string, supported?: string) =>
  families.ReflectTokens.of(
    `crate::api::core::reflect::Tokens { name: ${atom(attribute)}, supported: ${supported === undefined ? "None" : `Some(${strings(supported)})`} }`,
  );

/** To spread into the options of the interface of an HTML element. */
export const htmlConstructor = {
  rustTraits: ["crate::api::core::custom::HtmlConstructor"],
  construct: { passNewTarget: true, rustName: "construct_html", capability: "js", throws: true },
} as const;
