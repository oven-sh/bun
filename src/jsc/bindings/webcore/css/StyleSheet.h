#pragma once

#include "ScriptWrappable.h"
#include <wtf/Forward.h>
#include <wtf/RefCounted.h>
#include <wtf/TZoneMalloc.h>

namespace WebCore {

class MediaList;
class Node;
class WebCoreOpaqueRoot;

class StyleSheet : public ScriptWrappable, public RefCounted<StyleSheet> {
    WTF_MAKE_TZONE_ALLOCATED(StyleSheet);
public:
    virtual ~StyleSheet();

    virtual bool disabled() const = 0;
    virtual void setDisabled(bool) = 0;
    virtual Node* ownerNode() const = 0;
    virtual StyleSheet* parentStyleSheet() const { return nullptr; }
    virtual String href() const = 0;
    virtual String title() const = 0;
    virtual MediaList* media() const { return nullptr; }
    virtual String type() const = 0;

    virtual void clearOwnerNode() = 0;
    virtual bool isCSSStyleSheet() const { return false; }

    virtual WebCoreOpaqueRoot opaqueRootForGCThread() = 0;
};

} // namespace WebCore
