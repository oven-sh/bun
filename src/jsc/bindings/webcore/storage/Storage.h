#pragma once

#include "ExceptionOr.h"
#include "ScriptWrappable.h"
#include "WindowProperty.h"
#include <wtf/HashMap.h>
#include <wtf/RefCounted.h>
#include <wtf/Vector.h>
#include <wtf/text/StringHash.h>

namespace WebCore {

// https://html.spec.whatwg.org/multipage/webstorage.html#the-storage-interface
// In memory, and for one window. No other window shares it, so nothing ever hears a `storage` event from it.
class Storage final : public ScriptWrappable, public RefCounted<Storage>, public WindowProperty {
    WTF_MAKE_TZONE_ALLOCATED(Storage);
public:
    static Ref<Storage> create(Window& window) { return adoptRef(*new Storage(window)); }

    unsigned length() const { return m_items.size(); }
    String key(unsigned index) const;
    String getItem(const String& key) const { return m_items.get(key); }
    ExceptionOr<void> setItem(const String& key, const String& value);
    void removeItem(const String& key);
    void clear();

    bool isSupportedPropertyName(const String& key) const { return m_items.contains(key); }
    Vector<AtomString> supportedPropertyNames() const;

private:
    explicit Storage(Window& window)
        : WindowProperty(window)
    {
    }

    HashMap<String, String> m_items;
    Vector<String> m_keys; // In the order they were added.
    size_t m_size { 0 };
};

} // namespace WebCore
