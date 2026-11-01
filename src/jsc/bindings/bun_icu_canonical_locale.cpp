// `Intl.getCanonicalLocales` for Rust: the form that every Intl API gives one language tag before it looks for data.

#include "root.h"

#include <JavaScriptCore/IntlObject.h>

/// Returns the length of the canonical form of `tag`, which is written to `out` if it fits in `capacity`. Returns 0 if
/// `tag` is not a language tag.
extern "C" size_t Bun__canonicalLocaleTag(const uint8_t* tag, size_t length, uint8_t* out, size_t capacity)
{
    StringView text { std::span { byteCast<Latin1Character>(tag), length } };
    if (!text.containsOnlyASCII() || !JSC::isStructurallyValidLanguageTag(text))
        return 0;
    String canonical = JSC::canonicalizeUnicodeLocaleID(text);
    if (canonical.isNull())
        return 0;
    auto characters = byteCast<uint8_t>(canonical.span8());
    if (characters.size() <= capacity)
        memcpySpan(std::span { out, capacity }, characters);
    return characters.size();
}
