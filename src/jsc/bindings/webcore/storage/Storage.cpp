#include "config.h"
#include "Storage.h"

#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/AtomString.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(Storage);

// In UTF-16 code units, keys and values together. The same as jsdom's default, and about what browsers allow.
static constexpr size_t quota = 5000000;

String Storage::key(unsigned index) const
{
    return index < m_keys.size() ? m_keys[index] : String();
}

ExceptionOr<void> Storage::setItem(const String& key, const String& value)
{
    auto iterator = m_items.find(key);
    bool isNew = iterator == m_items.end();
    size_t size = m_size + value.length() + (isNew ? key.length() : 0) - (isNew ? 0 : iterator->value.length());
    if (size > quota)
        return Exception { ExceptionCode::QuotaExceededError, "The quota has been exceeded."_s };

    m_size = size;
    if (isNew) {
        m_items.add(key, value);
        m_keys.append(key);
    } else
        iterator->value = value;
    return { };
}

void Storage::removeItem(const String& key)
{
    auto value = m_items.take(key);
    if (value.isNull())
        return;
    m_size -= key.length() + value.length();
    m_keys.removeFirst(key);
}

void Storage::clear()
{
    m_items.clear();
    m_keys.clear();
    m_size = 0;
}

Vector<AtomString> Storage::supportedPropertyNames() const
{
    return m_keys.map([](auto& key) {
        return AtomString { key };
    });
}

} // namespace WebCore
