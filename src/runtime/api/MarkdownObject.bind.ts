import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::markdown_object" });

/** The parser reads a byte more than once. */
const input = b.bytes({ from: ["string", "buffer"], shared: "copied", held: "handle" });
const expected = { input: "Expected a string or buffer to render" } as const;

/** What is not an object is ignored. */
const ignoresNonObjects = { allowArray: true, nonObjectAsEmpty: true } as const;
const flag = b.bool.loose.optional;

export const AutolinkOptions = b.dictionary({ url: flag, www: flag, email: flag }, ignoresNonObjects);
export const Autolinks = b.union({ all: b.bool, each: AutolinkOptions });
export const HeadingOptions = b.dictionary({ ids: flag, autolink: flag }, ignoresNonObjects);
export const Headings = b.union({ all: b.bool, each: HeadingOptions });

const options = {
  autolinks: Autolinks.optional,
  headings: Headings.optional,
  tables: flag,
  strikethrough: flag,
  tasklists: flag,
  hardSoftBreaks: { type: flag, altNames: ["hard_soft_breaks"] },
  wikiLinks: { type: flag, altNames: ["wiki_links"] },
  underline: flag,
  latexMath: { type: flag, altNames: ["latex_math"] },
  collapseWhitespace: { type: flag, altNames: ["collapse_whitespace"] },
  permissiveAtxHeaders: { type: flag, altNames: ["permissive_atx_headers"] },
  noIndentedCodeBlocks: { type: flag, altNames: ["no_indented_code_blocks"] },
  noHtmlBlocks: { type: flag, altNames: ["no_html_blocks"] },
  noHtmlSpans: { type: flag, altNames: ["no_html_spans"] },
  tagFilter: { type: flag, altNames: ["tag_filter"] },
  noSingleTilde: flag,
  noReferenceDefinitions: flag,
  tablePipesInCode: flag,
  tableExtraCells: flag,
  maxNesting: b.u32.optional,
} as const;
export const MarkdownOptions = b.dictionary(options, { allowArray: true });
export const ReactOptions = b.dictionary({ reactVersion: b.f64.otherAsNull, ...options }, { allowArray: true });

export const AnsiTheme = b.dictionary(
  { colors: flag, hyperlinks: flag, kittyGraphics: flag, light: flag, columns: b.f64.otherAsNull },
  ignoresNonObjects,
);

const members = <Name extends string, T>(type: T, names: readonly Name[]) =>
  Object.fromEntries(names.map(name => [name, type])) as Record<Name, T>;

export const RenderCallbacks = b.dictionary(
  members(b.callable.otherAsNull, [
    "heading",
    "paragraph",
    "blockquote",
    "code",
    "list",
    "listItem",
    "hr",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "html",
    "strong",
    "emphasis",
    "link",
    "image",
    "codespan",
    "strikethrough",
    "text",
  ]),
  { allowArray: true },
);

/** The `type` of the elements of each tag. A boolean is ignored. */
export const ComponentOverrides = b.dictionary(
  members(b.any.emptyStringAsNull, [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "blockquote",
    "ul",
    "ol",
    "li",
    "pre",
    "hr",
    "html",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "em",
    "strong",
    "a",
    "img",
    "code",
    "del",
    "math",
    "u",
    "br",
  ]),
  { allowArray: true },
);

const js = { capability: "js", throws: true } as const;

/** A surrogate pair can be cut in two, so a string is not made UTF-8 by itself. */
const chunk = b.bytes({ from: ["string", "buffer"], string: "asIs", held: "handle" });
const renders = {
  returns: b.any.returning("string", "Array"),
  expected: { chunk: expected.input },
  passThis: true,
  ...js,
} as const;

export const MarkdownStream = b.class({
  rustPath: "crate::api::markdown_object::stream::MarkdownStream",
  estimatedSize: true,
  internalFields: {
    /** The `RenderCallbacks` or `ComponentOverrides`, as an array. */
    overrides: b.any,
    /** An array of the list items and table rows that a later call returns again. */
    kept: b.any,
    transform: b.cell("WebCore::JSTransformStream", "streams/JSTransformStream.h"),
  },
  proto: {
    write: { args: { chunk }, ...renders, calledFromCpp: true },
    preview: { ...renders, expected: {} },
    end: { args: { chunk: chunk.nullable }, ...renders, calledFromCpp: true },
    readable: { getter: b.any.returning("ReadableStream"), passThis: true, ...js },
    writable: { getter: b.any.returning("WritableStream"), passThis: true, ...js },
  },
  calledFromCpp: {
    /** Whether the internal fields can be emptied: no member is using them. */
    release: { returns: b.bool },
  },
  calledFromRust: {
    readableSide: { args: { isCalledDirectly: b.bool }, returns: b.any, throws: true },
    writableSide: { args: { isCalledDirectly: b.bool }, returns: b.any, throws: true },
    /** Whether the caller of `write` or `end` is not the transform, which is then of no more use. */
    detachUnlessPiping: { returns: b.any, throws: true },
  },
});

const streams = (name: string) =>
  ({ rustPath: `crate::api::markdown_object::stream::${name}`, returns: MarkdownStream, ...js }) as const;

export const markdown = b.namespace({
  html: { args: { input, options: MarkdownOptions.otherAsNull }, returns: b.string.utf8, expected, ...js },
  ansi: { args: { input, theme: AnsiTheme.default({}) }, returns: b.string.utf8, expected, length: 2, ...js },
  /** The callbacks run while `input` is read. */
  render: {
    args: { input: b.any, callbacks: RenderCallbacks.otherAsNull, options: MarkdownOptions.otherAsNull },
    returns: b.string.utf8,
    length: 3,
    ...js,
  },
  /** As `render`. */
  react: {
    args: { input: b.any, components: ComponentOverrides.otherAsNull, options: ReactOptions.otherAsNull },
    returns: b.any,
    length: 3,
    ...js,
  },
  tokens: { args: { input, options: MarkdownOptions.otherAsNull }, returns: b.any.returning("Array"), expected, ...js },
  htmlStream: { args: { options: MarkdownOptions.otherAsNull }, ...streams("html") },
  ansiStream: { args: { theme: AnsiTheme.default({}) }, ...streams("ansi") },
  renderStream: {
    args: { callbacks: RenderCallbacks.otherAsNull, options: MarkdownOptions.otherAsNull },
    ...streams("render"),
  },
  reactStream: {
    args: { components: ComponentOverrides.otherAsNull, options: ReactOptions.otherAsNull },
    ...streams("react"),
  },
  tokensStream: { args: { options: MarkdownOptions.otherAsNull }, ...streams("tokens") },
});
