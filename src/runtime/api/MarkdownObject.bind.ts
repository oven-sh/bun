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
});
