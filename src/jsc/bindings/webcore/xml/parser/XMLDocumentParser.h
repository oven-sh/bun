#pragma once

#include "ScriptableDocumentParser.h"
#include <wtf/TZoneMalloc.h>
#include <wtf/text/StringBuilder.h>

namespace WebCore {

class DocumentFragment;
class Element;

// Stands where upstream has its parser on top of libxml2. The text is parsed by Bun's XML parser (src/parsers/xml.rs), all of it when the input ends.
class XMLDocumentParser final : public ScriptableDocumentParser {
    WTF_MAKE_TZONE_ALLOCATED(XMLDocumentParser);
public:
    static Ref<XMLDocumentParser> create(Document& document, OptionSet<ParserContentPolicy> policy = DefaultParserContentPolicy)
    {
        return adoptRef(*new XMLDocumentParser(document, policy));
    }

    ~XMLDocumentParser();

    static bool parseDocumentFragment(const String&, DocumentFragment&, Element* parent = nullptr, OptionSet<ParserContentPolicy> = { ParserContentPolicy::AllowScriptingContent });

    // Used by XMLHttpRequest to check if the responseXML was well formed.
    bool wellFormed() const final { return !m_sawError; }

private:
    XMLDocumentParser(Document&, OptionSet<ParserContentPolicy>);

    void insert(SegmentedString&&) final;
    void append(RefPtr<StringImpl>&&) final;
    void finish() final;

    TextPosition textPosition() const final;

    void parse();

    StringBuilder m_source;
    bool m_sawError { false };
};

} // namespace WebCore
