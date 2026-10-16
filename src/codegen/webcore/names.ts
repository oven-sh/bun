// The tag and attribute names: HTMLNames.h, NodeName.{h,cpp}, TagName.{h,cpp}, HTMLElementFactory.{h,cpp}, JSHTMLElementWrapperFactory.{h,cpp},
// the same two factories for SVG, ...
// Upstream's make_names.pl prints them. This file changes what it prints in three ways.
//
// 1. The static names are the same on every thread. Upstream's `HTMLNames::divTag` is a process-wide QualifiedName, which holds AtomStrings,
//    and an AtomString belongs to one thread. In Bun the DOM works on every thread, so `divTag` is a constant that holds only its NodeName,
//    and each VM has a table of the QualifiedNames (dom/StaticNames.cpp).
// 2. A name that arrives as a 16-bit string is narrowed and looked up like an 8-bit one, which saves a second copy of the lookup functions.
// 3. Includes of headers that Bun does not have go.
import { type Files, dropUnknownIncludes, replaceAndCount, replaceOnce, sorted, useQuotedIncludes } from "./util.ts";

const raw = String.raw;

/**
 * Lines of html/HTMLTagNames.in that differ in Bun: tag -> the whole line.
 * - article, wbr: Bun has no class for them, they are plain HTMLElements.
 * - attachment, model: HTMLUnknownElement, as with upstream's default settings. They need a line: with `conditional=` off the generator
 *   leaves their `case` out, and createKnownElement() returns null for a name that findHTMLElementName() does know.
 * - audio, video, track, canvas, datalist, embed, selectedcontent: no setting, no condition, no "only if media is available".
 */
export const tagLines: Record<string, string> = {
  article: "article interfaceName=HTMLElement",
  attachment: "attachment interfaceName=HTMLUnknownElement",
  audio: "audio",
  canvas: "canvas",
  datalist: "datalist interfaceName=HTMLDataListElement",
  embed: "embed",
  model: "model interfaceName=HTMLUnknownElement",
  selectedcontent: "selectedcontent interfaceName=HTMLSelectedContentElement",
  track: "track",
  video: "video",
  wbr: "wbr interfaceName=HTMLElement",
};

export function editTagNames(upstream: string): string {
  const seen = new Set<string>();
  const text = upstream.replace(/^(\w+)(?: [^\n]*)?$/gm, (line, tag) => {
    if (!(tag in tagLines)) return line;
    seen.add(tag);
    return tagLines[tag];
  });
  for (const tag in tagLines) if (!seen.has(tag)) throw new Error(`HTMLTagNames.in has no line for ${tag}`);
  return text;
}

/** The SVG tags that have a class of their own, as in jsdom. Every other element in the SVG namespace is a plain SVGElement. */
export const svgTagsWithInterface = ["defs", "desc", "g", "metadata", "svg", "switch", "symbol", "title"];

/** svg/svgtags.in as the factories of SVG elements and of their wrappers see it: only those tags, and SVGElement for the rest. */
export function editSVGTagNames(upstream: string): string {
  const seen = new Set<string>();
  const lines = upstream.split("\n").filter(line => {
    const tag = line.match(/^([\w-]+)(?: |$)/)?.[1];
    if (tag === undefined) return true;
    if (!svgTagsWithInterface.includes(tag)) return false;
    seen.add(tag);
    return true;
  });
  for (const tag of svgTagsWithInterface) if (!seen.has(tag)) throw new Error(`svgtags.in has no line for ${tag}`);
  return replaceOnce(
    lines.join("\n"),
    /fallbackInterfaceName="SVGUnknownElement"/,
    'fallbackInterfaceName="SVGElement"',
    "svgtags.in: fallbackInterfaceName",
  );
}

const families = ["HTML", "SVG", "MathML", "XLink", "XML", "XMLNS"];

/** Files that make_names.pl prints and Bun has no use for. */
const unused = ["MathMLElementTypeHelpers.h", "XLinkElementTypeHelpers.h"];

function enumerators(header: string, name: string): string[] {
  const body = header.match(new RegExp(raw`enum class ${name} : \w+ \{([^]*?)\n\};`))![1];
  return Array.from(body.matchAll(/^\s+(\w+),(?: \/\/.*)?$/gm), m => m[1]);
}

const sameMembers = (a: Iterable<string>, b: Iterable<string>) =>
  sorted(new Set(a)).join() === sorted(new Set(b)).join();

function makeNamesStatic(files: Files): void {
  const read = (name: string) => {
    const text = files.get(name);
    if (text === undefined) throw new Error(`make_names.pl did not print ${name}`);
    return text;
  };

  // 1. What the .cpp files construct.
  const nodeNames = new Map<string, { string: string; namespace: string }>(); // by NodeName enumerator
  const variables = new Map<string, Map<string, string>>(); // family -> variable -> NodeName enumerator
  const namespaceURIs = new Map<string, string>(); // by Namespace enumerator
  const namespaceVariables = new Map<string, { variable: string; namespace: string }>(); // by family
  for (const family of families) {
    const cpp = read(`${family}Names.cpp`);
    const data = new Map(
      Array.from(
        cpp.matchAll(/static constexpr StringImpl::StaticStringImpl (\w+)Data\("([^"]*)", StringImpl::StringAtom\);/g),
        m => [m[1], m[2]],
      ),
    );
    const uri = cpp.match(/AtomString \w+NS\("([^"]+)"_s\);/)![1];
    const ofFamily = new Map<string, string>();
    variables.set(family, ofFamily);
    let familyNamespace = "";
    const constructions =
      /^\s+(\w+)\.construct\((\w+\(\)), AtomString\((\w+)Data\), (\w+(?:\(\))?), Namespace::(\w+), NodeName::(\w+)\);$/gm;
    for (const [, variable, prefix, dataVariable, namespaceArgument, namespace, nodeName] of cpp.matchAll(
      constructions,
    )) {
      if (prefix !== "nullAtom()")
        throw new Error(
          `${family}Names::${variable} has a prefix: operator==(QualifiedName, StaticQualifiedName) assumes that none has`,
        );
      if (namespaceArgument !== "nullAtom()") familyNamespace = namespace;
      const entry = { string: data.get(dataVariable)!, namespace };
      const known = nodeNames.get(nodeName);
      if (known && (known.string !== entry.string || known.namespace !== entry.namespace))
        throw new Error(`NodeName::${nodeName} has two meanings`);
      nodeNames.set(nodeName, entry);
      ofFamily.set(variable, nodeName);
    }
    namespaceURIs.set(familyNamespace, uri);
    namespaceVariables.set(family, {
      variable: cpp.match(/(\w+NamespaceURI)\.construct/)![1],
      namespace: familyNamespace,
    });
  }

  // 2. The enumerators, in order.
  let nodeNameHeader = read("NodeName.h");
  const nodeNameOrder = enumerators(nodeNameHeader, "NodeName");
  if (nodeNameOrder[0] !== "Unknown" || !sameMembers(nodeNameOrder.slice(1), nodeNames.keys()))
    throw new Error("the NodeName enumerators and the names in *Names.cpp differ");
  let tagNameHeader = read("TagName.h");
  const tagNameOrder = enumerators(tagNameHeader, "TagName");
  const namespaceOrder = enumerators(read("Namespace.h"), "Namespace");

  let tagNameImplementation = read("TagName.cpp");
  const tagStrings = new Map<string, string>();
  for (const [, tag, family, variable] of tagNameImplementation.matchAll(
    /strings\[TagName::(\w+)\] = (\w+)Names::(\w+)->localName\(\);/g,
  ))
    tagStrings.set(tag, nodeNames.get(variables.get(family)!.get(variable)!)!.string);
  for (const [, tag, string] of tagNameImplementation.matchAll(/strings\[TagName::(\w+)\] = "([^"]+)"_s;/g))
    tagStrings.set(tag, string);
  if (tagNameOrder[0] !== "Unknown" || !sameMembers(tagNameOrder.slice(1), tagStrings.keys()))
    throw new Error("the TagName enumerators and initializeTagNameStrings() differ");

  // 3. *Names.h: `extern LazyNeverDestroyed<const HTMLQualifiedName> divTag;` becomes `inline constexpr HTMLQualifiedName divTag { NodeName::HTML_div };`.
  for (const family of families) {
    const name = `${family}Names.h`;
    let h = read(name);
    h = replaceOnce(
      h,
      /#include "QualifiedName.h"\n#include <span>\n#include <wtf\/NeverDestroyed.h>\n#include <wtf\/text\/AtomString.h>\n\n/,
      '#include "NodeName.h"\n#include "QualifiedName.h"\n',
      `${name}: includes`,
    );
    h = replaceOnce(
      h,
      /(class \w+QualifiedName : public )QualifiedName( \{\npublic:\n    using )QualifiedName::QualifiedName;/,
      "$1StaticQualifiedName$2StaticQualifiedName::StaticQualifiedName;",
      `${family}QualifiedName`,
    );
    const { variable, namespace } = namespaceVariables.get(family)!;
    h = replaceOnce(
      h,
      new RegExp(raw`WEBCORE_EXPORT extern MainThreadLazyNeverDestroyed<const AtomString> ${variable};`),
      `inline constexpr StaticNamespaceURI ${variable} { Namespace::${namespace} };`,
      variable,
    );
    const ofFamily = variables.get(family)!;
    let count: number;
    [h, count] = replaceAndCount(
      h,
      /WEBCORE_EXPORT extern LazyNeverDestroyed<const WebCore::(\w+)> (\w+);/g,
      (_, kind, constant) =>
        `inline constexpr ${kind === "QualifiedName" ? "StaticQualifiedName" : kind} ${constant} { NodeName::${ofFamily.get(constant)} };`,
    );
    if (count !== ofFamily.size)
      throw new Error(`${name} declares ${count} names, ${family}Names.cpp constructs ${ofFamily.size}`);
    h = h.replace(/constexpr unsigned \w+Count = \d+;\n/g, "");
    h = h.replace(/std::span<[^\n]*> get\w+\(\);\n/g, "");
    h = replaceOnce(h, /\n+WEBCORE_EXPORT void init\(\);\n/, "\n", `${family}Names::init`);
    files.set(name, h);
    files.delete(`${family}Names.cpp`);
  }

  // 4. StaticNameTables.h has what the .cpp files held: one StaticStringImpl for each distinct string, and tables indexed by NodeName, TagName and Namespace.
  const identifier = (string: string) => string.replace(/\W/g, "_") + "Data";
  const strings = sorted(new Set([...Array.from(nodeNames.values(), entry => entry.string), ...tagStrings.values()]));
  if (new Set(strings.map(identifier)).size !== strings.length) throw new Error("two strings get the same identifier");
  files.set(
    "StaticNameTables.h",
    [
      "// Made by src/codegen/webcore/names.ts from what make_names.pl prints. Only dom/StaticNames.cpp includes this.",
      "",
      "#pragma once",
      "",
      '#include "NodeName.h"',
      "#include <wtf/text/StringImpl.h>",
      "",
      "namespace WebCore {",
      "",
      ...strings.map(
        string =>
          `static constexpr StringImpl::StaticStringImpl ${identifier(string)}("${string}", StringImpl::StringAtom);`,
      ),
      "",
      "struct StaticNameEntry {",
      "    const StringImpl::StaticStringImpl* localName;",
      "    Namespace nodeNamespace;",
      "};",
      "",
      "// Indexed by NodeName.",
      "static constexpr StaticNameEntry staticNameEntries[] = {",
      "    { nullptr, Namespace::Unknown },",
      ...nodeNameOrder
        .slice(1)
        .map(
          name =>
            `    { &${identifier(nodeNames.get(name)!.string)}, Namespace::${nodeNames.get(name)!.namespace} }, // ${name}`,
        ),
      "};",
      "",
      "// Indexed by TagName.",
      "static constexpr const StringImpl::StaticStringImpl* staticTagNames[] = {",
      "    nullptr,",
      ...tagNameOrder.slice(1).map(tag => `    &${identifier(tagStrings.get(tag)!)}, // ${tag}`),
      "};",
      "",
      "// Indexed by Namespace.",
      "static constexpr ASCIILiteral staticNamespaceURIs[] = {",
      ...namespaceOrder.map(namespace =>
        namespaceURIs.has(namespace)
          ? `    "${namespaceURIs.get(namespace)}"_s, // ${namespace}`
          : `    { }, // ${namespace}`,
      ),
      "};",
      "",
      "} // namespace WebCore",
      "",
    ].join("\n"),
  );

  // 5. NodeName.{h,cpp}: qualifiedNameForNodeName() is a table lookup.
  nodeNameHeader = replaceOnce(
    nodeNameHeader,
    /(\n};\n)(\nusing ElementName = NodeName;)/,
    `$1\ninline constexpr auto lastNodeNameEnumValue = NodeName::${nodeNameOrder.at(-1)};\n$2`,
    "the end of enum class NodeName",
  );
  files.set("NodeName.h", nodeNameHeader);
  files.set(
    "NodeName.cpp",
    replaceOnce(
      read("NodeName.cpp"),
      /(const QualifiedName& qualifiedNameForNodeName\(NodeName nodeName\)\n\{\n    ASSERT\(nodeName != NodeName::Unknown\);\n)[^]*?\n\}\n/,
      "$1    return StaticQualifiedName { nodeName }.get();\n}\n",
      "qualifiedNameForNodeName",
    ),
  );

  // 6. TagName.{h,cpp}: the process-wide tagNameStrings and initializeTagNameStrings() go. dom/StaticNames.cpp defines tagNameAsString().
  tagNameHeader = replaceOnce(
    tagNameHeader,
    /inline LazyNeverDestroyed<EnumeratedArray<TagName, AtomString, lastTagNameEnumValue>> tagNameStrings;\n\nWEBCORE_EXPORT void initializeTagNameStrings\(\);\n/,
    "\nWEBCORE_EXPORT const AtomString& tagNameAsString(TagName);\n",
    "tagNameStrings",
  );
  tagNameHeader = replaceOnce(
    tagNameHeader,
    /inline const AtomString& tagNameAsString\(TagName tagName\)\n\{\n    return tagNameStrings.get\(\)\[tagName\];\n\}\n\n/,
    "",
    "tagNameAsString",
  );
  tagNameHeader = replaceOnce(
    tagNameHeader,
    /#include <wtf\/EnumeratedArray.h>\n#include <wtf\/NeverDestroyed.h>\n/,
    "",
    "TagName.h: includes",
  );
  files.set("TagName.h", tagNameHeader);
  files.set(
    "TagName.cpp",
    replaceOnce(
      tagNameImplementation,
      /void initializeTagNameStrings\(\) \{\n[^]*?\n\}\n\n/,
      "",
      "initializeTagNameStrings",
    ),
  );
}

function narrowWideNames(text: string): string {
  const sizes = Array.from(text.matchAll(/^    case (\d+): \{$/gm), m => Number(m[1]));
  const longest = Math.max(...sizes);
  text = replaceOnce(
    text,
    /NodeName findNodeName\(Namespace ns, const String& name\)\n\{\n    if \(name\.is8Bit\(\)\)\n        return findNodeNameFromBuffer\(ns, name\.span8\(\)\);\n    return findNodeNameFromBuffer\(ns, name\.span16\(\)\);\n\}\n/,
    `// Every known name is ASCII, so a 16-bit string is narrowed and looked up like an 8-bit one. That saves a second copy of the lookups (58 KB for the attributes alone).
class NarrowedName {
public:
    explicit NarrowedName(std::span<const char16_t> characters)
    {
        if (characters.size() > m_buffer.size())
            return;
        for (size_t i = 0; i < characters.size(); ++i) {
            if (!isASCII(characters[i]))
                return;
            m_buffer[i] = static_cast<Latin1Character>(characters[i]);
        }
        m_length = characters.size();
    }

    // Empty for a string that cannot be a known name. No known name is empty.
    std::span<const Latin1Character> span() const { return std::span { m_buffer }.first(m_length); }

private:
    static constexpr size_t lengthOfLongestName = ${longest};
    std::array<Latin1Character, lengthOfLongestName> m_buffer;
    size_t m_length { 0 };
};

NodeName findNodeName(Namespace ns, const String& name)
{
    if (name.is8Bit())
        return findNodeNameFromBuffer(ns, name.span8());
    return findNodeNameFromBuffer(ns, NarrowedName { name.span16() }.span());
}
`,
    "findNodeName",
  );
  // findHTMLNodeName() keeps its 16-bit copy: the fast path of the HTML parser calls it on 16-bit input.
  for (const family of ["SVG", "MathML"])
    text = replaceOnce(
      text,
      new RegExp(raw`    return find${family}NodeName\(name\.span16\(\)\);\n`),
      `    return find${family}NodeName(NarrowedName { name.span16() }.span());\n`,
      `find${family}ElementName`,
    );
  return text;
}

/**
 * `files` is what make_names.pl printed. `interfaces` has the names of the interfaces with a binding.
 * `knownHeaders` has the name of every header that Bun can include. The headers among `files` are added to it.
 */
export function adaptNames(files: Files, interfaces: Set<string>, knownHeaders: Set<string>): void {
  for (const name of unused) files.delete(name);
  for (const [name, text] of files) {
    files.set(name, useQuotedIncludes(text));
    if (name.endsWith(".h")) knownHeaders.add(name);
  }
  makeNamesStatic(files);
  files.set("NodeName.cpp", narrowWideNames(files.get("NodeName.cpp")!));

  for (const family of ["HTML", "SVG"]) {
    for (const name of [`${family}ElementFactory.cpp`, `JS${family}ElementWrapperFactory.cpp`])
      files.set(name, dropUnknownIncludes(files.get(name)!, knownHeaders).replace(/\n{3,}/g, "\n\n"));
    for (const [, element] of files.get(`JS${family}ElementWrapperFactory.cpp`)!.matchAll(/createWrapper<(\w+)>/g))
      if (!interfaces.has(element))
        throw new Error(
          `${element} has no binding: add it to interfaces.txt, or give its tag another interfaceName in names.ts`,
        );

    // make_names.pl takes it that every known tag has a constructor. Most SVG tags have none here, and are plain SVGElements.
    if (family === "SVG")
      files.set(
        "SVGElementFactory.cpp",
        replaceOnce(
          files.get("SVGElementFactory.cpp")!,
          /    if \(elementName != ElementName::Unknown\)\n        return (createKnownElement\(tagNameForElementName\(elementName\), document, createdByParser\))\.releaseNonNull\(\);\n/,
          "    if (elementName != ElementName::Unknown) {\n        if (auto result = $1)\n            return result.releaseNonNull();\n    }\n",
          "SVGElementFactory::createElement(const AtomString&)",
        ),
      );

    let header = files.get(`JS${family}ElementWrapperFactory.h`)!;
    header = replaceOnce(
      header,
      /#include <wtf\/Forward.h>\n\nnamespace WebCore \{\n/,
      "#include <wtf/Forward.h>\n\nnamespace Zig {\nclass GlobalObject;\n}\n\nnamespace WebCore {\n",
      `JS${family}ElementWrapperFactory.h: namespace`,
    );
    header = replaceOnce(
      header,
      /    class JSDOMGlobalObject;\n/,
      "    using JSDOMGlobalObject = Zig::GlobalObject;\n",
      `JS${family}ElementWrapperFactory.h: JSDOMGlobalObject`,
    );
    files.set(`JS${family}ElementWrapperFactory.h`, header);
  }
}
