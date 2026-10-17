#pragma once

#include "CSSPropertyNames.h"
#include "IsImportant.h"
#include <wtf/RefCounted.h>
#include <wtf/RefPtr.h>
#include <wtf/Vector.h>
#include <wtf/text/AtomString.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

// One declaration of a shorthand. The longhands it was expanded to share it, which is how the shorthand
// is written back the way it was set for as long as none of them has been set again.
class CSSShorthandValue : public RefCounted<CSSShorthandValue> {
public:
    static Ref<CSSShorthandValue> create(CSSPropertyID shorthand, String&& text, bool hasVariableReferences)
    {
        return adoptRef(*new CSSShorthandValue(shorthand, WTF::move(text), hasVariableReferences));
    }

    CSSPropertyID shorthand() const { return m_shorthand; }
    const String& text() const { return m_text; }
    // The longhands have no value of their own until var() is substituted.
    bool hasVariableReferences() const { return m_hasVariableReferences; }

private:
    CSSShorthandValue(CSSPropertyID shorthand, String&& text, bool hasVariableReferences)
        : m_text(WTF::move(text))
        , m_shorthand(shorthand)
        , m_hasVariableReferences(hasVariableReferences)
    {
    }

    String m_text;
    CSSPropertyID m_shorthand;
    bool m_hasVariableReferences;
};

// A declaration of a longhand or of a custom property. The value is its serialization: there are no CSSValue objects.
class CSSProperty {
public:
    CSSProperty(CSSPropertyID id, String&& value, IsImportant important = IsImportant::No, RefPtr<CSSShorthandValue>&& shorthandValue = nullptr)
        : m_value(WTF::move(value))
        , m_shorthandValue(WTF::move(shorthandValue))
        , m_id(id)
        , m_important(important == IsImportant::Yes)
    {
        ASSERT(id != CSSPropertyID::Invalid && id != CSSPropertyID::Custom);
    }

    CSSProperty(const AtomString& customPropertyName, String&& value, IsImportant important = IsImportant::No)
        : m_value(WTF::move(value))
        , m_customPropertyName(customPropertyName)
        , m_id(CSSPropertyID::Custom)
        , m_important(important == IsImportant::Yes)
    {
    }

    CSSPropertyID id() const { return m_id; }
    bool isImportant() const { return m_important; }
    void setIsImportant(IsImportant important) { m_important = important == IsImportant::Yes; }

    // Empty for a longhand of a shorthand with var() in it.
    const String& value() const { return m_value; }
    const AtomString& customPropertyName() const { return m_customPropertyName; }
    String cssName() const { return m_id == CSSPropertyID::Custom ? m_customPropertyName.string() : nameString(m_id); }

    CSSShorthandValue* shorthandValue() const { return m_shorthandValue.get(); }
    CSSPropertyID shorthandID() const { return m_shorthandValue ? m_shorthandValue->shorthand() : CSSPropertyID::Invalid; }
    bool isPendingSubstitution() const { return m_shorthandValue && m_shorthandValue->hasVariableReferences(); }

    // Whether both serialize the same.
    bool operator==(const CSSProperty& other) const
    {
        if (m_id != other.m_id || m_important != other.m_important || m_value != other.m_value || m_customPropertyName != other.m_customPropertyName)
            return false;
        if (isPendingSubstitution() != other.isPendingSubstitution())
            return false;
        return !isPendingSubstitution() || (shorthandID() == other.shorthandID() && m_shorthandValue->text() == other.m_shorthandValue->text());
    }

private:
    String m_value;
    AtomString m_customPropertyName;
    RefPtr<CSSShorthandValue> m_shorthandValue;
    CSSPropertyID m_id;
    bool m_important;
};

using ParsedPropertyVector = Vector<CSSProperty, 4>;

} // namespace WebCore
